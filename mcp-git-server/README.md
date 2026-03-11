# MCP Git Server

A NestJS-based MCP (Model Context Protocol) server that exposes GitHub and GitLab repository tools to any MCP-compatible AI client (Cursor, Claude Desktop, etc.).

## Features

- **GitHub tools**: list repos, get repo details, list branches, read files, list issues, create issues
- **GitLab tools**: list projects, get project details, list branches, read files, list issues, create issues
- HTTP/SSE transport (compatible with Cursor and Claude Desktop)
- Environment-based token configuration

## Available Tools

### GitHub

| Tool | Description |
|------|-------------|
| `github_list_repos` | List repositories for the authenticated user or a specific user/org |
| `github_get_repo` | Get detailed info about a specific repository |
| `github_list_branches` | List branches in a repository |
| `github_get_file` | Read file contents from a repository |
| `github_list_issues` | List issues with optional state/label filters |
| `github_create_issue` | Create a new issue |

### GitLab

| Tool | Description |
|------|-------------|
| `gitlab_list_projects` | List accessible GitLab projects |
| `gitlab_get_project` | Get detailed info about a specific project |
| `gitlab_list_branches` | List branches in a project |
| `gitlab_get_file` | Read file contents from a project |
| `gitlab_list_issues` | List issues with optional state/label filters |
| `gitlab_create_issue` | Create a new issue |

## Setup

### 1. Clone and install dependencies

```bash
cd mcp-git-server
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your tokens:

```env
# GitHub Personal Access Token
# Create at: https://github.com/settings/tokens
# Required scopes: repo, read:user
GITHUB_TOKEN=ghp_your_token_here

# GitLab Personal Access Token
# Create at: https://gitlab.com/-/user_settings/personal_access_tokens
# Required scopes: api, read_repository
GITLAB_TOKEN=glpat_your_token_here

# GitLab instance URL (change for self-hosted)
GITLAB_URL=https://gitlab.com

PORT=3000
```

### 3. Start the server

```bash
# Development (with hot reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

The server will log the available endpoints on startup:

```
MCP Git Server running on http://localhost:3000
SSE endpoint:      http://localhost:3000/mcp/sse
Messages endpoint: http://localhost:3000/mcp/messages
```

## Connecting to Cursor

1. Open Cursor Settings → MCP
2. Click **Add new MCP server**
3. Fill in the form:
   - **Name**: `git-mcp-server` (or any name you prefer)
   - **Type**: `sse`
   - **URL**: `http://localhost:3000/mcp/sse`
4. Save and enable the server

Cursor will automatically discover all 12 tools and make them available in your AI conversations.

## Connecting to Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "git-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-git-server/dist/main.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "GITLAB_TOKEN": "glpat_your_token_here",
        "GITLAB_URL": "https://gitlab.com",
        "PORT": "3000"
      }
    }
  }
}
```

## Project Structure

```
src/
├── main.ts               # Entry point, starts HTTP server
├── app.module.ts         # Root module: wires MCPModule, GitHubModule, GitLabModule
├── github/
│   ├── github.module.ts
│   └── github.service.ts # 6 GitHub @Tool methods
└── gitlab/
    ├── gitlab.module.ts
    └── gitlab.service.ts # 6 GitLab @Tool methods
```

## Extending the Server

To add a new tool, add a method with the `@Tool` decorator to the relevant service:

```typescript
@Tool({
  name: 'github_list_pull_requests',
  description: 'List pull requests in a GitHub repository.',
  parameters: {
    owner: 'string',
    repo: 'string',
    state: 'string?',
  },
})
async listPullRequests(params: { owner: string; repo: string; state?: string }) {
  const { data } = await this.octokit.pulls.list({ ...params, state: params.state ?? 'open' });
  return JSON.stringify(data.map(pr => ({ number: pr.number, title: pr.title, html_url: pr.html_url })), null, 2);
}
```

No additional registration is needed — the `MCPModule` auto-discovers all `@Tool` decorated methods.
