This repository contains a web application that demonstrates the integration of ThoughtSpot with a Gemini-powered AI agent. The application provides a conversational interface where users can ask questions in natural language, and the agent will analyze data from ThoughtSpot to provide insights.

### How it Works

The application works by using a combination of a React frontend and a Node.js backend with Express.

1.  **Chat Initialization**: When the application loads, it initializes a chat session with the backend by calling the `/api/start` endpoint. This creates a new chat session with the Gemini model.
2.  **User Interaction**: The user can ask questions through a chat interface. When a message is sent, it's forwarded to the backend's `/api/send` endpoint.
3.  **Query Decomposition**: The backend agent, using a Gemini model with a system instruction to act as a helpful assistant, receives the user's question. The agent is designed to use a `getRelevantData` tool when it determines that it needs to fetch data to answer the question.
4.  **Data Retrieval from ThoughtSpot**: The `getRelevantData` function is the bridge to ThoughtSpot. It first uses ThoughtSpot's query decomposition API to break down the user's high-level question into more specific, data-oriented questions that can be answered by ThoughtSpot. It then gets the answers to these questions from ThoughtSpot in CSV format and can even ask follow-up questions to get more detailed information.
5.  **Liveboard Creation**: The retrieved data is then used to create a ThoughtSpot Liveboard, which is a collection of visualizations. The application returns the URL of this Liveboard.
6.  **Response Generation**: The data and the Liveboard URL are sent back to the Gemini model as context. The model then generates a user-friendly response that summarizes the findings, provides recommendations, and includes a link to the Liveboard for further exploration. This response is streamed back to the frontend and displayed in the chat interface.

### Architecture

The application has a client-server architecture:

* **Frontend**: A single-page application built with React and Vite.
    * It uses Ant Design for UI components like the chat drawer, input fields, and buttons.
    * The `ChatSidebar.tsx` component manages the chat interface, message history, and streaming of responses from the backend.
    * The `Liveboard.tsx` component uses the ThoughtSpot Visual Embed SDK to embed a Liveboard directly into the application.
* **Backend**: An Express.js server that acts as the agent.
    * `api/agent.ts`: This is the core of the backend. It sets up the Express server, defines the API endpoints (`/api/start`, `/api/send`), and manages the interaction with the Gemini model.
    * `api/thoughtspot.ts`: This file contains the functions for interacting with the ThoughtSpot REST API, such as getting relevant questions (`getRelevantQuestions`), fetching answers (`getAnswerForQuestion`), and creating Liveboards (`createLiveboard`).
    * `api/relevant-data.ts`: This file defines the `getRelevantData` function that the Gemini model can call. This function orchestrates the process of getting data from ThoughtSpot.
    * `api/thoughtspot-client.ts`: This file configures and exports a ThoughtSpot REST API client, which is used to make the actual API calls to ThoughtSpot. It also includes a workaround for exporting an unsaved answer's TML (ThoughtSpot Modeling Language) representation.

### Code Walkthrough

**Backend (`api/`):**

1.  **`agent.ts`**: The main entry point for the backend.
    * It initializes the Gemini model with a system instruction to act as a helpful assistant that can use the `getRelevantData` tool.
    * The `/api/start` endpoint creates a new chat session and stores it in a map with a unique ID.
    * The `/api/send` endpoint receives messages from the user, sends them to the Gemini model, and streams the response back to the client. It handles both text responses and function calls to `getRelevantData`.
    * The `handleFunctionCall` function is invoked when the Gemini model decides to use the `getRelevantData` tool. It calls the `getRelevantData` function and then sends the results back to the model as a function response.
2.  **`relevant-data.ts`**:
    * Defines the schema for the `getRelevantData` function, which tells the Gemini model what arguments the function expects (a `query` string).
    * The `getRelevantData` function first calls `getRelevantQuestions` to get a list of questions to ask ThoughtSpot. It then calls `getAnswersForQuestions` to get the answers to those questions. It can also ask follow-up questions based on the initial results. Finally, it creates a Liveboard and returns all the answers and the Liveboard URL.
3.  **`thoughtspot.ts`**:
    * `getRelevantQuestions`: Calls ThoughtSpot's `queryGetDecomposedQuery` API to break down a user's query.
    * `getAnswerForQuestion`: Gets the data for a specific question from ThoughtSpot.
    * `createLiveboard`: Creates a new Liveboard using the TML of the answers.
4.  **`thoughtspot-client.ts`**:
    * Initializes the ThoughtSpot REST API SDK with the necessary authentication configuration. It supports both bearer tokens and a token server.
    * It includes a workaround to export the TML of an unsaved answer by making a direct GraphQL request to the ThoughtSpot server, as this functionality is not yet available in the public API.

**Frontend (`src/`):**

1.  **`App.tsx`**: The main component that sets up the layout of the application, including the header, content, and footer. It also includes the `ChatButton` and `ChatSidebar` components.
2.  **`components/ChatSidebar.tsx`**:
    * This component manages the state of the chat, including the messages, input value, and loading state.
    * The `handleSendMessage` function sends the user's message to the backend and handles the streaming response. It updates the UI in real-time as new chunks of the response are received.
    * The `renderMessage` function is responsible for rendering both user and assistant messages. It uses `ReactMarkdown` to render the assistant's response, which can include formatted text and a link to the Liveboard. It also extracts the Liveboard ID from the message and renders the `Liveboard` component if an ID is found.
3.  **`components/Liveboard.tsx`**: A simple component that uses the `@thoughtspot/visual-embed-sdk/react` library to embed a ThoughtSpot Liveboard using its ID.
4.  **`vite.config.ts`**: The Vite configuration file sets up a proxy to forward requests from `/api` to the backend server running on `http://localhost:4000`, which avoids CORS issues during development.