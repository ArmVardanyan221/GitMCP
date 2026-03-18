import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GitHubService } from './github/github.service.js';
import { GitLabService } from './gitlab/gitlab.service.js';

interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

interface ChatRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, string>;
}

// Ollama chat API types
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

const TOOL_REGISTRY: ToolInfo[] = [
  {
    name: 'github_list_repos',
    description:
      'List repositories for the authenticated GitHub user or a specific user/org.',
    parameters: { username: 'string?', per_page: 'number?', page: 'number?' },
  },
  {
    name: 'github_get_repo',
    description: 'Get detailed information about a specific GitHub repository.',
    parameters: { owner: 'string', repo: 'string' },
  },
  {
    name: 'github_list_branches',
    description: 'List branches in a GitHub repository.',
    parameters: {
      owner: 'string',
      repo: 'string',
      per_page: 'number?',
      page: 'number?',
    },
  },
  {
    name: 'github_get_file',
    description: 'Read the contents of a file from a GitHub repository.',
    parameters: {
      owner: 'string',
      repo: 'string',
      path: 'string',
      ref: 'string?',
    },
  },
  {
    name: 'github_list_issues',
    description: 'List issues in a GitHub repository.',
    parameters: {
      owner: 'string',
      repo: 'string',
      state: 'string?',
      labels: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a new issue in a GitHub repository.',
    parameters: {
      owner: 'string',
      repo: 'string',
      title: 'string',
      body: 'string?',
      labels: 'string?',
      assignees: 'string?',
    },
  },
  {
    name: 'gitlab_list_projects',
    description: 'List GitLab projects accessible to the authenticated user.',
    parameters: {
      search: 'string?',
      membership: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  },
  {
    name: 'gitlab_get_project',
    description: 'Get detailed information about a specific GitLab project.',
    parameters: { project_id: 'string' },
  },
  {
    name: 'gitlab_list_branches',
    description: 'List branches in a GitLab project.',
    parameters: {
      project_id: 'string',
      search: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  },
  {
    name: 'gitlab_get_file',
    description: 'Read a file from a GitLab repository.',
    parameters: { project_id: 'string', file_path: 'string', ref: 'string?' },
  },
  {
    name: 'gitlab_list_issues',
    description: 'List issues in a GitLab project.',
    parameters: {
      project_id: 'string',
      state: 'string?',
      labels: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  },
  {
    name: 'gitlab_create_issue',
    description: 'Create a new issue in a GitLab project.',
    parameters: {
      project_id: 'string',
      title: 'string',
      description: 'string?',
      labels: 'string?',
      assignee_ids: 'string?',
    },
  },
];

// Ollama tool definitions (OpenAI-compatible format)
const OLLAMA_TOOLS: OllamaTool[] = TOOL_REGISTRY.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object' as const,
      properties: Object.fromEntries(
        Object.entries(tool.parameters).map(([key, typeStr]) => {
          const baseType = typeStr.replace('?', '');
          return [
            key,
            {
              type: baseType === 'number' ? 'number' : 'string',
              description: `${key} (${typeStr})`,
            },
          ];
        }),
      ),
      required: Object.entries(tool.parameters)
        .filter(([, typeStr]) => !typeStr.endsWith('?'))
        .map(([key]) => key),
    },
  },
}));

@Controller('api')
export class ApiController {
  private readonly logger = new Logger(ApiController.name);
  private readonly ollamaUrl: string;
  private readonly ollamaModel: string;

  constructor(
    private readonly github: GitHubService,
    private readonly gitlab: GitLabService,
    private readonly config: ConfigService,
  ) {
    this.ollamaUrl = this.config.get<string>(
      'OLLAMA_URL',
      'http://localhost:11434',
    );
    this.ollamaModel = this.config.get<string>('OLLAMA_MODEL', 'qwen2.5:7b');
    this.logger.log(
      `Ollama configured: ${this.ollamaUrl} with model ${this.ollamaModel}`,
    );
  }

  @Get('tools')
  listTools() {
    return TOOL_REGISTRY;
  }

  @Post('tools/call')
  async callTool(@Body() body: ToolCallRequest) {
    const { name, arguments: args } = body;
    this.logger.log(`Calling tool: ${name}`);

    try {
      const result = await this.dispatchTool(name, args);
      return { content: [{ type: 'text', text: result }], isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool ${name} failed: ${message}`);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  @Post('chat')
  async chat(@Body() body: ChatRequest) {
    const { message, history = [] } = body;
    this.logger.log(`Chat request: ${message}`);

    const systemPrompt = `You are a helpful Git assistant that can interact with GitHub and GitLab repositories.
You have access to tools for listing repos, getting repo details, listing branches, reading files, listing issues, and creating issues — on both GitHub and GitLab.
When the user asks something, use the appropriate tool to fulfill their request.
After getting tool results, summarize them in a clear, human-friendly way.
If the user's request is unclear, ask for clarification.
Keep responses concise and informative.`;

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({
        role: h.role,
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    try {
      const allToolResults: Array<{ tool: string; result: string }> = [];

      // Call Ollama with tools
      let response = await this.callOllama(messages);

      // Process tool calls in a loop
      while (response.message.tool_calls?.length) {
        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.message.content || '',
        });

        // Execute each tool call and add results
        for (const toolCall of response.message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolInput = toolCall.function.arguments;

          this.logger.log(
            `AI calling tool: ${toolName}(${JSON.stringify(toolInput)})`,
          );

          try {
            const result = await this.dispatchTool(toolName, toolInput);
            allToolResults.push({ tool: toolName, result });
            messages.push({
              role: 'tool',
              content: result,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              content: `Error: ${errorMsg}`,
            });
          }
        }

        // Call Ollama again with tool results
        response = await this.callOllama(messages);
      }

      return {
        message: response.message.content,
        toolCalls: allToolResults,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Chat error: ${errorMsg}`);
      return {
        message: `Sorry, I encountered an error: ${errorMsg}`,
        toolCalls: [],
        isError: true,
      };
    }
  }

  private async callOllama(
    messages: OllamaMessage[],
  ): Promise<OllamaChatResponse> {
    const { data } = await axios.post<OllamaChatResponse>(
      `${this.ollamaUrl}/api/chat`,
      {
        model: this.ollamaModel,
        messages,
        tools: OLLAMA_TOOLS,
        stream: false,
      },
      { timeout: 120000 },
    );
    return data;
  }

  private async dispatchTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    switch (name) {
      // GitHub tools
      case 'github_list_repos':
        return this.github.listRepos(args as any);
      case 'github_get_repo':
        return this.github.getRepo(args as any);
      case 'github_list_branches':
        return this.github.listBranches(args as any);
      case 'github_get_file':
        return this.github.getFile(args as any);
      case 'github_list_issues':
        return this.github.listIssues(args as any);
      case 'github_create_issue':
        return this.github.createIssue(args as any);

      // GitLab tools
      case 'gitlab_list_projects':
        return this.gitlab.listProjects(args as any);
      case 'gitlab_get_project':
        return this.gitlab.getProject(args as any);
      case 'gitlab_list_branches':
        return this.gitlab.listBranches(args as any);
      case 'gitlab_get_file':
        return this.gitlab.getFile(args as any);
      case 'gitlab_list_issues':
        return this.gitlab.listIssues(args as any);
      case 'gitlab_create_issue':
        return this.gitlab.createIssue(args as any);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
