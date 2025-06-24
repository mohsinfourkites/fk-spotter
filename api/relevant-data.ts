import { SchemaType } from "@google/generative-ai";
import { createLiveboard, getAnswerForQuestion, getRelevantQuestions } from "./thoughtspot";

export const relevantDataFunctionDefinition: any = {
    name: "getRelevantData",
    description: "Given a textual query, this tool gets the single most relevant answer and an associated visualization from a relational data warehouse. It returns the data for the single best question that answers the user's query.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "The user's query that will be answered with a single, targeted visualization.",
            },
            // **THE FIX: Add a parameter for chart type**
            chartType: {
                type: SchemaType.STRING,
                description: "Optional. The desired type of chart to visualize the data. Supported types include: 'COLUMN', 'BAR', 'LINE', 'PIE', 'AREA', 'SCATTER', 'BUBBLE', 'HEATMAP', 'TABLE'. Defaults to the best fit if not specified."
            }
        },
        required: ["query"],
    },
};

export const getRelevantData = async (
    args: { query: string, chartType?: string }, 
    streamCb: (data: any) => void, 
    history: any[] = []
) => {
    try {
        const { query, chartType } = args; // Destructure the arguments

        const contextString = history
            .map(h => {
                const role = h.role === 'model' ? 'assistant' : h.role;
                const text = h.parts?.map((p: any) => p.text || '').join('') || '';
                return `${role}: ${text}`;
            })
            .join('\n');

        const relevantQuestions = await getRelevantQuestions(query, contextString);

        if (!relevantQuestions || relevantQuestions.length === 0) {
            streamCb("Sorry, I could not determine a specific data question to ask based on your query. Please try rephrasing it.");
            return { allAnswers: [], liveboard: null };
        }

        const primaryQuestion = relevantQuestions[0];
        console.log(`[DEBUG] Identified primary question: "${primaryQuestion}", Chart Type: ${chartType || 'Default'}`);
        streamCb(`Searching for an answer to: "${primaryQuestion}"...`);

        // Pass the requested chartType to the function that gets the answer.
        const answer = await getAnswerForQuestion(primaryQuestion, chartType);

        if (!answer) {
            streamCb(`Sorry, I was unable to retrieve data for the question: "${primaryQuestion}".`);
            return { allAnswers: [], liveboard: null };
        }

        const singleAnswerArray = [answer];
        const liveboard = await createLiveboard(query, singleAnswerArray);
        
        return {
            allAnswers: singleAnswerArray,
            liveboard,
        };
    } catch (error) {
        console.error("[ERROR] in getRelevantData:", error);
        streamCb("An unexpected error occurred while trying to fetch data from ThoughtSpot. Please try again.");
        return { allAnswers: [], liveboard: null };
    }
};