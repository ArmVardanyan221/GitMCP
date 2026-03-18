import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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

// Claude tool definitions for the AI chat endpoint
const CLAUDE_TOOLS: Anthropic.Tool[] = TOOL_REGISTRY.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: {
    type: 'object' as const,
    properties: Object.fromEntries(
      Object.entries(tool.parameters).map(([key, typeStr]) => {
        const isOptional = typeStr.endsWith('?');
        const baseType = isOptional ? typeStr.slice(0, -1) : typeStr;
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
}));

@Controller('api')
export class ApiController {
  private readonly logger = new Logger(ApiController.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly github: GitHubService,
    private readonly gitlab: GitLabService,
    private readonly config: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
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
      const message =
        error instanceof Error ? error.message : String(error);
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

    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ];

    try {
      let response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: CLAUDE_TOOLS,
        messages,
      });

      // Process tool calls in a loop (Claude may call multiple tools)
      const allToolResults: Array<{ tool: string; result: string }> = [];

      while (response.stop_reason === 'tool_use') {
        const assistantContent = response.content;
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of assistantContent) {
          if (block.type !== 'tool_use') continue;
          const toolName = block.name;
          const toolInput = block.input as Record<string, unknown>;
          const toolId = block.id;

          this.logger.log(
            `AI calling tool: ${toolName}(${JSON.stringify(toolInput)})`,
          );
          try {
            const result = await this.dispatchTool(toolName, toolInput);
            allToolResults.push({ tool: toolName, result });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: result,
            });
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: `Error: ${errorMsg}`,
              is_error: true,
            });
          }
        }

        // Continue the conversation with tool results
        messages.push({
          role: 'assistant',
          content: assistantContent.map((block) => {
            if (block.type === 'tool_use') {
              return {
                type: 'tool_use' as const,
                id: block.id,
                name: block.name,
                input: block.input,
              };
            }
            return {
              type: 'text' as const,
              text: (block as Anthropic.TextBlock).text,
            };
          }),
        });
        messages.push({ role: 'user', content: toolResults });

        response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          tools: CLAUDE_TOOLS,
          messages,
        });
      }

      // Extract the final text response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text',
      );
      const assistantMessage = textBlocks.map((b) => b.text).join('\n');

      return {
        message: assistantMessage,
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
