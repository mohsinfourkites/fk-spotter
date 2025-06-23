import { useState, useEffect, useRef } from 'react';
import { Input, Button, List, Typography, Spin } from 'antd';
import { SendOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Liveboard from './components/Liveboard';
import './App.css';

const { Text, Title } = Typography;

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  isStreaming?: boolean;
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
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to initialize chat');
      }
      
      const data = await response.json();
      setChatId(data.chatId);
      // Set the initial message
      setMessages([
        {
          id: 'initial-message',
          content: "Hello! I'm here to assist you with any Spotter-related queries you may have. Please feel free to ask your questions, and I'll be happy to help!",
          sender: 'assistant'
        }
      ]);
    } catch (error) {
      console.error('Error initializing chat:', error);
    } finally {
        setIsLoading(false);
    }
  };

  // Initialize chat session when component mounts
  useEffect(() => {
    if (!chatId) {
      initializeChat();
    }
  }, [chatId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewChat = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    setInputValue('');
    initializeChat();
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !chatId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue,
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          message: inputValue,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      let accumulatedResponse = '';
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        const chunk = new TextDecoder().decode(value);
        accumulatedResponse += chunk;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: accumulatedResponse }
              : msg
          )
        );
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg
        )
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('Request was aborted');
      } else {
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  const renderMessage = (message: Message) => {
    const liveboardMatch = message.content.match(
        /(?:https:\/\/[^/]+\/#\/pinboard\/([^/\s)]+)|\[.*?\]\(https:\/\/[^/]+\/#\/pinboard\/([^/\s)]+)\))/
      );
    const liveboardId = liveboardMatch ? (liveboardMatch[1] || liveboardMatch[2]) : null;
  
    return (
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
        {/* This div acts as a spacer to push the content to the bottom */}
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
                className="new-chat-button"
            >
                New Chat
            </Button>
            <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me something..."
                disabled={isLoading}
                className="chat-input"
            />
            <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                className="send-button"
            >
                Send
            </Button>
        </div>
      </div>
    </div>
  )
}

export default App;