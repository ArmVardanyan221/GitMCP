import { useState, useEffect, useRef, useCallback } from 'react';
import { MCPClient, type MCPTool, type MCPCallResult } from './mcp-client';
import './App.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'result';
  content: string;
  timestamp: Date;
  toolName?: string;
  isError?: boolean;
  isJson?: boolean;
}

interface ChatResponse {
  message: string;
  toolCalls: Array<{ tool: string; result: string }>;
  isError?: boolean;
}

const client = new MCPClient('http://localhost:3000');

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [showToolPanel, setShowToolPanel] = useState(false);
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addMessage = useCallback(
    (role: Message['role'], content: string, extra?: Partial<Message>) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role,
          content,
          timestamp: new Date(),
          ...extra,
        },
      ]);
    },
    [],
  );

  // Connect to server on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await client.connect();
        if (cancelled) return;
        const toolList = await client.listTools();
        if (cancelled) return;

        setTools(toolList);
        setConnected(true);
        setConnecting(false);
        addMessage(
          'system',
          `Connected to MCP Git Server. ${toolList.length} tools available.\nType **help** to see available commands, or type a natural language query.`,
        );
      } catch (err) {
        if (cancelled) return;
        setConnecting(false);
        addMessage(
          'system',
          `Failed to connect to MCP server at http://localhost:3000. Make sure the server is running.\n\nError: ${err instanceof Error ? err.message : String(err)}`,
          { isError: true },
        );
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [addMessage]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatResult = (result: MCPCallResult): { text: string; isJson: boolean } => {
    const text = result.content.map((c) => c.text).join('\n');
    try {
      const parsed = JSON.parse(text);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { text, isJson: false };
    }
  };

  const handleToolCall = async (toolName: string, args: Record<string, unknown>) => {
    setLoading(true);
    try {
      const result = await client.callTool(toolName, args);
      const formatted = formatResult(result);
      addMessage('result', formatted.text, {
        toolName,
        isError: result.isError,
        isJson: formatted.isJson,
      });
    } catch (err) {
      addMessage('result', `Error: ${err instanceof Error ? err.message : String(err)}`, {
        toolName,
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    addMessage('user', trimmed);
    setInput('');

    if (trimmed.toLowerCase() === 'tools') {
      const toolList = tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n');
      addMessage('system', `**Available Tools (${tools.length}):**\n\n${toolList}`);
      return;
    }

    // Send to AI chat endpoint — Claude understands any natural language
    setLoading(true);
    try {
      // Build conversation history from recent messages
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: ChatResponse = await response.json();

      // Show which tools were called
      if (data.toolCalls.length > 0) {
        for (const tc of data.toolCalls) {
          try {
            const parsed = JSON.parse(tc.result);
            addMessage('result', JSON.stringify(parsed, null, 2), {
              toolName: tc.tool,
              isJson: true,
            });
          } catch {
            addMessage('result', tc.result, { toolName: tc.tool });
          }
        }
      }

      // Show AI's response
      addMessage('assistant', data.message, { isError: data.isError });
    } catch (err) {
      addMessage(
        'system',
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { isError: true },
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToolFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTool || loading) return;

    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toolArgs)) {
      if (value.trim()) {
        const num = Number(value);
        args[key] = !isNaN(num) && value.trim() !== '' ? num : value.trim();
      }
    }

    addMessage('user', `[Tool Call] ${selectedTool.name}(${JSON.stringify(args)})`);
    addMessage('system', `Calling \`${selectedTool.name}\`...`);
    await handleToolCall(selectedTool.name, args);
  };

  const selectTool = (tool: MCPTool) => {
    setSelectedTool(tool);
    setToolArgs({});
  };

  const renderMarkdown = (text: string) => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>MCP Git Client</h1>
          <span
            className={`status ${connected ? 'connected' : connecting ? 'connecting' : 'disconnected'}`}
          >
            {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
          </span>
        </div>
        <button
          className={`tool-toggle ${showToolPanel ? 'active' : ''}`}
          onClick={() => setShowToolPanel(!showToolPanel)}
        >
          Tools ({tools.length})
        </button>
      </header>

      <div className="main-layout">
        <div className="chat-container">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty-state">
                <h2>MCP Git Client</h2>
                <p>
                  {connecting
                    ? 'Connecting to MCP server...'
                    : 'Type a command to interact with GitHub/GitLab'}
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                <div className="message-header">
                  <span className="message-role">
                    {msg.role === 'user'
                      ? 'You'
                      : msg.role === 'assistant'
                        ? 'AI'
                        : msg.role === 'system'
                          ? 'System'
                          : 'Result'}
                  </span>
                  {msg.toolName && <span className="tool-badge">{msg.toolName}</span>}
                  <span className="message-time">{msg.timestamp.toLocaleTimeString()}</span>
                </div>
                <div className="message-body">
                  {msg.isJson ? (
                    <pre className="json-output">{msg.content}</pre>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="message system">
                <div className="message-body">
                  <div className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="input-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                connected
                  ? 'Ask anything... (e.g. "show my GitHub repos", "what issues are open in owner/repo?")'
                  : 'Waiting for connection...'
              }
              disabled={!connected || loading}
            />
            <button type="submit" disabled={!connected || loading || !input.trim()}>
              Send
            </button>
          </form>
        </div>

        {showToolPanel && (
          <div className="tool-panel">
            <div className="tool-list">
              <h3>Available Tools</h3>
              {tools.map((tool) => (
                <button
                  key={tool.name}
                  className={`tool-item ${selectedTool?.name === tool.name ? 'selected' : ''}`}
                  onClick={() => selectTool(tool)}
                >
                  <span className="tool-name">{tool.name}</span>
                  <span className="tool-desc">{tool.description}</span>
                </button>
              ))}
            </div>

            {selectedTool && (
              <div className="tool-form">
                <h3>{selectedTool.name}</h3>
                <p className="tool-description">{selectedTool.description}</p>
                <form onSubmit={handleToolFormSubmit}>
                  {selectedTool.parameters &&
                    Object.entries(selectedTool.parameters).map(([key, type]) => (
                      <div key={key} className="form-field">
                        <label>
                          {key}
                          {!type.endsWith('?') && <span className="required">*</span>}
                        </label>
                        <input
                          type="text"
                          value={toolArgs[key] || ''}
                          onChange={(e) =>
                            setToolArgs((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder={type}
                        />
                      </div>
                    ))}
                  <button type="submit" disabled={loading} className="run-tool-btn">
                    {loading ? 'Running...' : 'Run Tool'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
