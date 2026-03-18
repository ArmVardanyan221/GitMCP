// MCP Client - connects to the NestJS server via REST API

export interface MCPTool {
  name: string;
  description: string;
  parameters?: Record<string, string>;
}

export interface MCPCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class MCPClient {
  private _isConnected = false;

  constructor(private baseUrl: string = 'http://localhost:3000') {}

  /** Check connection by fetching tools list */
  async connect(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/tools`);
    if (!response.ok) {
      throw new Error(`Failed to connect: HTTP ${response.status}`);
    }
    this._isConnected = true;
  }

  /** List all available tools */
  async listTools(): Promise<MCPTool[]> {
    const response = await fetch(`${this.baseUrl}/api/tools`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /** Call a tool by name with arguments */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<MCPCallResult> {
    const response = await fetch(`${this.baseUrl}/api/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  disconnect() {
    this._isConnected = false;
  }

  get isConnected() {
    return this._isConnected;
  }
}
