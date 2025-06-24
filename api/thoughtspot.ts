import { thoughtSpotClient } from "./thoughtspot-client";

const DATA_SOURCE_ID = process.env.VITE_TS_DATASOURCE_ID || "";
const THOUGHTSPOT_HOST: string = process.env.VITE_THOUGHTSPOT_HOST || "";


export async function getRelevantQuestions(query: string, additionalContext: string = ''): Promise<string[]> {
    // ... (This function remains the same)
    console.log("[DEBUG] Getting relevant questions for query: ", query, "with additional context: ", additionalContext);
    const startTime = Date.now();
    try {
        const questions = await thoughtSpotClient.queryGetDecomposedQuery({
            nlsRequest: {
                query: query,
            },
            content: [
                additionalContext,
            ],
            worksheetIds: [DATA_SOURCE_ID]
        })
        const endTime = Date.now();
        console.log("[DEBUG] Time taken to get relevant questions: ", endTime - startTime, "ms");
        return questions.decomposedQueryResponse?.decomposedQueries?.map((q) => q.query!) || [];
    } catch (e) {
        const endTime = Date.now();
        console.log("[DEBUG] Time taken to get relevant questions: ", endTime - startTime, "ms");
        console.error("[DEBUG] Error getting relevant questions: ", e);
        return ["Error getting relevant questions"];
    }
}

// **THE FIX: Update this function to accept and use the chartType**
export async function getAnswerForQuestion(question: string, chartType?: string) {
    console.log(`[DEBUG] Getting answer for question: "${question}" with chart type: ${chartType}`);
    
    // The singleAnswer call now includes the visualization parameter if a chartType is provided.
    const answer = await thoughtSpotClient.singleAnswer({
        query: question,
        metadata_identifier: DATA_SOURCE_ID,
        visualization: chartType ? { type: chartType.toUpperCase() as any } : undefined,
    });

    console.log("[DEBUG] Getting Data for question: ", question);
    const [data, tml] = await Promise.all([
        thoughtSpotClient.exportAnswerReport({
            session_identifier: answer.session_identifier!,
            generation_number: answer.generation_number!,
            file_format: "CSV",
        }),
        (thoughtSpotClient as any).exportUnsavedAnswerTML({
            session_identifier: answer.session_identifier!,
            generation_number: answer.generation_number!,
        })
    ]);

    return {
        question,
        ...answer,
        data: await data.text(),
        tml,
    };
}

export async function createLiveboard(name: string, answers: any[]) {
    // ... (This function remains the same)
    const tml = {
        liveboard: {
            name,
            visualizations: answers.map((answer, idx) => ({
                id: `Viz_${idx}`,
                answer: {
                    ...answer.tml.answer,
                    name: answer.question,
                },
            })),
            layout: {
                tiles: answers.map((answer, idx) => ({
                    visualization_id: `Viz_${idx}`,
                    size: 'MEDIUM_SMALL'
                }))
            },
        }
    };

    const resp = await thoughtSpotClient.importMetadataTML({
        metadata_tmls: [JSON.stringify(tml)],
        import_policy: "ALL_OR_NONE",
    })

    let host = THOUGHTSPOT_HOST;
    if (!/^https?:\/\//i.test(host)) {
        host = `https://${host}`;
    }
    return `${host}/#/pinboard/${resp[0].response.header.id_guid}`;
}