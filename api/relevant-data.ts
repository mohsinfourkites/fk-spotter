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
        },
        required: ["query"],
    },
};

export const getRelevantData = async (query: string, streamCb: (data: any) => void, history: any[] = []) => {
    try {
        // Create a string from the chat history to use as context for the ThoughtSpot API.
        const contextString = history
            .map(h => {
                const role = h.role === 'model' ? 'assistant' : h.role;
                // Safely access text parts of a message
                const text = h.parts?.map((p: any) => p.text || '').join('') || '';
                return `${role}: ${text}`;
            })
            .join('\n');

        // Step 1: Get the best single data question, now with conversational context.
        const relevantQuestions = await getRelevantQuestions(query, contextString);

        if (!relevantQuestions || relevantQuestions.length === 0) {
            streamCb("Sorry, I could not determine a specific data question to ask based on your query. Please try rephrasing it.");
            return { allAnswers: [], liveboard: null };
        }

        const primaryQuestion = relevantQuestions[0];
        console.log(`[DEBUG] Identified primary question with context: "${primaryQuestion}"`);
        streamCb(`Searching for an answer to: "${primaryQuestion}"...`);

        // Step 2: Get the single answer for that question.
        const answer = await getAnswerForQuestion(primaryQuestion);

        if (!answer) {
            streamCb(`Sorry, I was unable to retrieve data for the question: "${primaryQuestion}".`);
            return { allAnswers: [], liveboard: null };
        }

        // Step 3: Create a Liveboard with the single visualization.
        const singleAnswerArray = [answer];
        const liveboard = await createLiveboard(query, singleAnswerArray);
        
        // Step 4: Return the result to be processed by the AI model.
        return {
            allAnswers: singleAnswerArray,
            liveboard,
        };
    } catch (error) {
        // **IMPROVED ERROR HANDLING**
        // If any part of the process fails, log the error and inform the user.
        console.error("[ERROR] in getRelevantData:", error);
        streamCb("An unexpected error occurred while trying to fetch data from ThoughtSpot. Please try again.");
        return { allAnswers: [], liveboard: null };
    }
};