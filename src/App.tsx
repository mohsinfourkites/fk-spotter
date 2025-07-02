import { useState, useEffect, useRef } from 'react';
import { Input, Button, List, Typography, Spin } from 'antd';
import { SendOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Liveboard from './components/Liveboard';
import './App.css';

const { Text, Title } = Typography;

// **NEW**: Message interface now includes optional suggestions
interface Message {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  isStreaming?: boolean;
  suggestions?: string[];
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const initializeChat = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to initialize chat');
      
      const data = await response.json();
      setChatId(data.chatId);
      setMessages([{
        id: 'initial-message',
        content: "Hello! I'm here to assist you with any Spotter-related queries. How can I help you today?",
        sender: 'assistant'
      }]);
    } catch (error) {
      console.error('Error initializing chat:', error);
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!chatId) initializeChat();
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewChat = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setInputValue('');
    initializeChat();
  };

  const handleSendMessage = async (messageText: string) => {
    if (!messageText.trim() || !chatId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageText,
      sender: 'user',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantMessageId, content: '', sender: 'assistant', isStreaming: true },
    ]);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message: messageText }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error('Failed to send message');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      let accumulatedResponse = '';
      const specialMarker = "<<END_OF_RESPONSE>>";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        accumulatedResponse += new TextDecoder().decode(value);

        // **NEW**: Check for the special marker to parse suggestions
        if (accumulatedResponse.includes(specialMarker)) {
          const parts = accumulatedResponse.split(specialMarker);
          const mainContent = parts[0];
          const jsonString = parts[1];
          
          try {
            const parsedJson = JSON.parse(jsonString);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: mainContent.trim(), suggestions: parsedJson.suggestions || [] }
                  : msg
              )
            );
          } catch (e) {
            // If JSON is incomplete, just update the text for now
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId ? { ...msg, content: mainContent } : msg
              )
            );
          }
        } else {
            // Standard text streaming
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId ? { ...msg, content: accumulatedResponse } : msg
              )
            );
        }
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg
        )
      );
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sending message:', error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: 'Sorry, there was an error processing your request.', isStreaming: false }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  // **NEW**: Handler for clicking a suggestion button
  const handleSuggestionClick = (suggestion: string) => {
    handleSendMessage(suggestion);
  };

  const renderMessage = (message: Message) => {
    const liveboardMatch = message.content.match(
        /(?:https:\/\/[^/]+\/#\/pinboard\/([^/\s)]+)|\[.*?\]\(https:\/\/[^/]+\/#\/pinboard\/([^/\s)]+)\))/
      );
    const liveboardId = liveboardMatch ? (liveboardMatch[1] || liveboardMatch[2]) : null;
  
    return (
      <div className={`message-wrapper`}>
        <div className={`message-container ${message.sender}`}>
          <div className={`message-bubble ${message.sender}`}>
            <ReactMarkdown>{message.content}</ReactMarkdown>
            {message.isStreaming && <Spin size="small" style={{ marginLeft: 8 }} />}
            {liveboardId && (
              <div style={{ marginTop: '16px', height: '600px', width: '100%' }}>
                <Liveboard liveboardId={liveboardId} />
              </div>
            )}
          </div>
        </div>
        {/* **NEW**: Render suggestion buttons if they exist */}
        {message.suggestions && message.suggestions.length > 0 && (
          <div className="suggestions-container">
            {message.suggestions.map((suggestion, index) => (
              <Button key={index} className="suggestion-button" onClick={() => handleSuggestionClick(suggestion)}>
                {suggestion}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="chat-app-container">
        <div className="chat-header">
            <div className="logo-title">
                <img src="/fourkites.png" alt="Spotter Logo" className="header-logo" />
                <Title level={3} style={{ color: 'white', margin: 0, fontWeight: 'normal' }}>
                    Spotter
                </Title>
            </div>
        </div>
      <div className="message-list-container">
        <div style={{ flexGrow: 1 }}></div>
        <List
            dataSource={messages}
            renderItem={(message) => (
                <List.Item style={{ border: 'none', padding: '0', marginTop: '8px' }}>
                {renderMessage(message)}
                </List.Item>
            )}
        />
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-wrapper">
        <div className="chat-input-container">
            <Button
                icon={<ReloadOutlined />}
                onClick={handleNewChat}
                className="chat-action-button"
            >
                New Chat
            </Button>
            <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage(inputValue))}
                placeholder="Ask me something..."
                disabled={isLoading}
                className="chat-input"
            />
            <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => handleSendMessage(inputValue)}
                disabled={!inputValue.trim() || isLoading}
                className="chat-action-button"
            >
                Send
            </Button>
        </div>
      </div>
    </div>
  )
}

export default App;