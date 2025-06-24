import { GoogleGenerativeAI, Part, Content, ChatSession } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";
import { getRelevantData, relevantDataFunctionDefinition } from "./relevant-data";
import { randomUUID } from "crypto";

const app = express();

const PORT = process.env.AGENT_PORT || 4000;
const AI_PROVIDER = process.env.VITE_AI_PROVIDER || 'GEMINI';

// --- AI Provider Initialization ---
let gemini: GoogleGenerativeAI;
let anthropic: Anthropic;
let generativeModel: any;

if (AI_PROVIDER === 'GEMINI') {
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    generativeModel = gemini.getGenerativeModel({
        // ** THIS IS THE CHANGED LINE **
        model: "gemini-2.0-flash",
        tools: [{ functionDeclarations: [relevantDataFunctionDefinition] }],
        systemInstruction: getSystemInstruction(),
    });
} else if (AI_PROVIDER === 'CLAUDE') {
    anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
    });
}

const chatIdToHistoryMap = new Map<string, any[]>();

// --- Express Middleware ---
app.use(cors());
app.use(express.json());

// --- API Endpoints ---
app.post('/api/start', async function (req, res) {
    const uuid = randomUUID();
    chatIdToHistoryMap.set(uuid, []);
    return res.json({ chatId: uuid });
});

app.post('/api/send', async function (req, res) {
    const { chatId, message } = req.body;
    let history = chatIdToHistoryMap.get(chatId);

    if (history === undefined) {
        return res.status(404).json({ error: "Chat not found" });
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();

    try {
        if (AI_PROVIDER === 'CLAUDE') {
            history.push({ role: "user", content: message });
            await handleClaudeRequest(history, res);
        } else { // GEMINI
            const chat = generativeModel.startChat({ history });
            const result = await chat.sendMessageStream(message);
            await processGeminiStream(result.stream, res, chat);

            const finalHistory = await chat.getHistory();
            chatIdToHistoryMap.set(chatId, finalHistory);
        }
        res.end();
    } catch (error) {
        console.error("Error in streaming response:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error processing request" });
        } else {
            res.write("\n\nAn unexpected error occurred while processing your request.");
            res.end();
        }
    }
});

app.get('/', function (req, res) {
    res.json({ message: "Hello, world!" });
});


// --- Gemini Handlers ---
async function processGeminiStream(stream: any, res: express.Response, chat: ChatSession) {
    for await (const chunk of stream) {
        if (chunk.candidates && chunk.candidates[0].content) {
            const part = chunk.candidates[0].content.parts[0];
            
            if (part.functionCall) {
                await handleGeminiFunctionCall(part.functionCall, res, chat);
            } else if (part.text) {
                res.write(part.text);
            }
        }
    }
}

async function handleGeminiFunctionCall(functionCall: Part['functionCall'], res: express.Response, chat: ChatSession) {
    if (!functionCall) return;

    const currentHistory = await chat.getHistory();
    const { allAnswers, liveboard } = await getRelevantData(
        (functionCall.args as { query: string }).query,
        (data) => {
            res.write(data);
        },
        currentHistory
    );

    if (!allAnswers || allAnswers.length === 0) {
        console.log("[INFO] getRelevantData returned no answers. Halting this turn.");
        return;
    }

    const functionResponse = {
        functionResponse: {
            name: "getRelevantData",
            response: {
                data: allAnswers.map(answer => ({
                    question: answer.question,
                    interpretation: answer.tokens,
                    data: answer.data,
                    liveboard: liveboard,
                })),
            },
        },
    };

    const result = await chat.sendMessageStream([functionResponse]);
    await processGeminiStream(result.stream, res, chat);
}


// --- Claude Handler ---
async function handleClaudeRequest(history: any[], res: express.Response) {
    const claudeToolDefinition = {
        name: relevantDataFunctionDefinition.name,
        description: relevantDataFunctionDefinition.description,
        input_schema: relevantDataFunctionDefinition.parameters,
    };

    const stream = anthropic.messages.stream({
        model: "claude-3-haiku-20240307",
        messages: history,
        system: getSystemInstruction(),
        tools: [claudeToolDefinition],
        max_tokens: 4096,
    });

    let fullResponse = "";
    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const chunkText = event.delta.text;
            fullResponse += chunkText;
            res.write(chunkText);
        }
    }
    history.push({ role: "assistant", content: fullResponse });
}


// --- Shared System Instruction ---
function getSystemInstruction() {
    return `
        You are a helpful assistant, which can answer questions by using the relevant data tool which returns relevant data from a database to answer any question. Use the tool when you feel appropriate. The questions are generally business questions. Like "How do I increase sales?" You will get the relevant data and provide a summary with specific actions and recommendations based on the data and your own knowledge. Quote specific data points from the data to support your recommendations, make all numbers human readable. Provide a link to the liveboard at the end of your response for the user to open in a new tab in a read friendly format.
    `;
}

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`Using AI Provider: ${AI_PROVIDER}`);
});