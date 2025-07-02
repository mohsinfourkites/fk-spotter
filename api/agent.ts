import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import { getRelevantData, relevantDataFunctionDefinition } from "./relevant-data";
import { randomUUID } from "crypto";

const app = express();

const PORT = process.env.AGENT_PORT || 4000;

// --- AI Provider Initialization (Anthropic Only) ---
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const chatIdToHistoryMap = new Map<string, any[]>();

// --- Express Middleware ---
app.use(cors());
app.use(express.json());

// --- API Endpoints ---
app.post('/api/start', (req, res) => {
    const uuid = randomUUID();
    chatIdToHistoryMap.set(uuid, []);
    console.log(`[INFO] New chat session started: ${uuid}`);
    res.json({ chatId: uuid });
});

app.post('/api/send', async (req, res) => {
    const { chatId, message } = req.body;
    let history = chatIdToHistoryMap.get(chatId);

    if (history === undefined) {
        return res.status(404).json({ error: "Chat not found" });
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();

    try {
        history.push({ role: "user", content: message });
        await handleClaudeRequest(history, res);
        res.end();
    } catch (error) {
        console.error("Error in streaming response:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error processing request" });
        } else {
            res.write("\n\nAn unexpected error occurred.");
            res.end();
        }
    }
});


// --- Anthropic Handler with Tool Use ---
async function handleClaudeRequest(history: any[], res: express.Response) {
    const claudeToolDefinition: Anthropic.Tool = {
        name: relevantDataFunctionDefinition.name,
        description: relevantDataFunctionDefinition.description,
        input_schema: relevantDataFunctionDefinition.parameters as any,
    };

    const messageResponse = await anthropic.messages.create({
        // ** THE FIX: Updated model and added max_tokens **
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        system: getSystemInstruction(),
        messages: history as any,
        tools: [claudeToolDefinition],
        stream: false,
    });

    const lastMessage = messageResponse.content[messageResponse.content.length - 1];

    if (lastMessage.type === 'tool_use') {
        const toolUse = lastMessage as Anthropic.ToolUseBlock;
        const functionArgs = toolUse.input as { query: string, chartType?: string };

        history.push({ role: 'assistant', content: [lastMessage] });

        const { allAnswers, liveboard } = await getRelevantData(functionArgs, (data) => res.write(data), history);

        if (!allAnswers || allAnswers.length === 0) return;

        const toolResult: Anthropic.ToolResultBlockParam = {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(allAnswers.map(a => ({...a, liveboard}))),
        };
        
        history.push({ role: 'user', content: [toolResult] });

        const finalStream = anthropic.messages.stream({
            // ** THE FIX: Updated model and added max_tokens **
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 4096,
            system: getSystemInstruction(),
            messages: history as any,
        });

        let fullResponse = "";
        for await (const event of finalStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                fullResponse += event.delta.text;
                res.write(event.delta.text);
            }
        }
        history.push({ role: 'assistant', content: fullResponse });

    } else {
        const textResponse = (lastMessage as Anthropic.TextBlock).text;
        res.write(textResponse);
        history.push({ role: 'assistant', content: textResponse });
    }
}


function getSystemInstruction() {
    return `
        You are a helpful and collaborative data analysis assistant. Your primary goal is to help users understand their data by answering questions and providing insights.

        BEHAVIOR RULES:
        1.  **Tool Use**: Use the 'getRelevantData' tool when the user asks a question about their data.
        2.  **Disambiguation**: If a user's query is ambiguous (e.g., "show me sales"), you MUST ask a clarifying question before using any tools. For example, ask "Do you mean sales by total dollar amount, number of units, or profit margin?". Do not guess.
        
        3.  **CHARTING LOGIC (VERY IMPORTANT)**:
            -   When a user asks for a specific chart type like a 'bar chart', 'pie chart', or 'column chart', you MUST check if the previous query was for a list of items or an aggregation.
            -   If the previous query was a list (e.g., "Show me the last 100 loads"), you CANNOT create a bar chart from it directly. You MUST transform the new query into an aggregation. For example, transform the query to "show the COUNT of loads BY ETA status as a bar chart".
            -   Always try to create a summarized or aggregated query when a user asks for a non-table visualization. If you determine that the requested chart type is impossible for the given data (e.g., a pie chart for data with no clear categories), you must explicitly state this in your response. For example: "A pie chart isn't suitable for this data as there are too many unique values. However, I have generated a bar chart that shows the top 10 categories."

        4.  **Summarization**: After receiving data from a tool, provide a concise, insightful summary of the findings. Quote specific data points to support your summary.
        5.  **Proactive Suggestions**: After providing your summary and the liveboard link, you MUST ALWAYS propose 3 to 4 relevant, insightful follow-up questions the user could ask.

        OUTPUT FORMAT:
        -   First, provide your natural language summary.
        -   Second, provide the link to the liveboard.
        -   Finally, end your response with a special JSON block containing your suggestions. This block must be on its own line and be the very last thing in your response.
        -   JSON format: <<END_OF_RESPONSE>>{"suggestions": ["Suggestion 1?", "Suggestion 2?", "Suggestion 3?"]}<<END_OF_RESPONSE>>
    `;
}

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`Using AI Provider: ANTHROPIC`);
});