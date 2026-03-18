// Smart prompt parser - maps natural language to MCP tool calls
// Uses keyword-based intent matching for flexible natural language understanding

import type { MCPTool } from './mcp-client';

export interface ParsedCommand {
  toolName: string;
  args: Record<string, unknown>;
  description: string;
}

// Normalize input: lowercase, collapse whitespace, remove punctuation
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[?!.,;:'"]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract owner/repo patterns like "owner/repo" from input
function extractOwnerRepo(input: string): { owner: string; repo: string } | null {
  const match = input.match(/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

// Extract a quoted string or the last meaningful phrase
function extractTitle(input: string): string | null {
  const quoted = input.match(/"([^"]+)"|'([^']+)'|«([^»]+)»/);
  if (quoted) return quoted[1] || quoted[2] || quoted[3];

  // Try to find title after keywords like "titled", "called", "named", "title:"
  const titled = input.match(/(?:titled?|called|named|title[:\s])\s*(.+)/i);
  if (titled) return titled[1].trim();

  return null;
}

// Extract a file path (anything that looks like a path with / or . extension)
function extractFilePath(input: string): string | null {
  const match = input.match(/(?:file\s+)?([a-zA-Z0-9_/.-]+\.[a-zA-Z0-9]+)/);
  if (match && match[1].includes('.')) return match[1];
  return null;
}

// Extract a project ID (numeric or namespace/path)
function extractProjectId(input: string): string | null {
  // Numeric project ID
  const numMatch = input.match(/(?:project\s*(?:id)?[\s:#]*)?(\d{2,})/);
  if (numMatch) return numMatch[1];

  // namespace/path style (but not owner/repo which is github-style)
  const pathMatch = input.match(/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

// Extract username after "for", "of", "by" etc.
function extractUsername(input: string): string | null {
  const match = input.match(/(?:for|of|by|user)\s+([a-zA-Z0-9._-]+)/i);
  if (match) return match[1];
  return null;
}

// Check if text contains any of the keywords
function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

// Determine if user is talking about GitHub or GitLab
function detectPlatform(text: string): 'github' | 'gitlab' | 'unknown' {
  if (text.includes('gitlab') || text.includes('git lab')) return 'gitlab';
  if (text.includes('github') || text.includes('git hub')) return 'github';
  return 'unknown';
}

// Intent keywords for each action type
const LIST_KEYWORDS = ['list', 'show', 'get', 'fetch', 'find', 'display', 'see', 'view', 'what', 'which', 'all', 'my'];
const CREATE_KEYWORDS = ['create', 'open', 'new', 'add', 'make', 'submit', 'file'];
const DETAIL_KEYWORDS = ['detail', 'info', 'about', 'describe', 'tell me about', 'information'];
const READ_KEYWORDS = ['read', 'cat', 'content', 'contents', 'open', 'look at'];

// Resource keywords
const REPO_KEYWORDS = ['repo', 'repos', 'repository', 'repositories'];
const BRANCH_KEYWORDS = ['branch', 'branches'];
const ISSUE_KEYWORDS = ['issue', 'issues', 'bug', 'bugs', 'ticket', 'tickets'];
const FILE_KEYWORDS = ['file', 'code', 'source', 'readme', 'package.json'];
const PROJECT_KEYWORDS = ['project', 'projects'];

/**
 * Parse a natural language prompt into an MCP tool call.
 * Uses keyword-based intent detection for flexible matching.
 * Returns null if no intent can be determined.
 */
export function parsePrompt(
  input: string,
  _availableTools: MCPTool[],
): ParsedCommand | null {
  const text = normalize(input);
  const platform = detectPlatform(text);

  const isListIntent = hasAny(text, LIST_KEYWORDS);
  const isCreateIntent = hasAny(text, CREATE_KEYWORDS);
  const isDetailIntent = hasAny(text, DETAIL_KEYWORDS);
  const isReadIntent = hasAny(text, READ_KEYWORDS);

  const isRepo = hasAny(text, REPO_KEYWORDS);
  const isBranch = hasAny(text, BRANCH_KEYWORDS);
  const isIssue = hasAny(text, ISSUE_KEYWORDS);
  const isFile = hasAny(text, FILE_KEYWORDS);
  const isProject = hasAny(text, PROJECT_KEYWORDS);

  const ownerRepo = extractOwnerRepo(input);

  // --- GitLab tools ---
  if (platform === 'gitlab' || (isProject && platform !== 'github')) {
    // Create issue
    if (isCreateIntent && isIssue) {
      const projectId = extractProjectId(input);
      const title = extractTitle(input);
      if (projectId && title) {
        return {
          toolName: 'gitlab_create_issue',
          args: { project_id: projectId, title },
          description: 'Creating GitLab issue',
        };
      }
    }

    // List issues
    if (isListIntent && isIssue) {
      const projectId = extractProjectId(input);
      if (projectId) {
        return {
          toolName: 'gitlab_list_issues',
          args: { project_id: projectId },
          description: 'Listing GitLab issues',
        };
      }
    }

    // Get file
    if ((isReadIntent || isFile) && isFile) {
      const projectId = extractProjectId(input);
      const filePath = extractFilePath(input);
      if (projectId && filePath) {
        return {
          toolName: 'gitlab_get_file',
          args: { project_id: projectId, file_path: filePath },
          description: 'Reading GitLab file',
        };
      }
    }

    // List branches
    if (isListIntent && isBranch) {
      const projectId = extractProjectId(input);
      if (projectId) {
        return {
          toolName: 'gitlab_list_branches',
          args: { project_id: projectId },
          description: 'Listing GitLab branches',
        };
      }
    }

    // Get project details
    if (isDetailIntent && isProject) {
      const projectId = extractProjectId(input);
      if (projectId) {
        return {
          toolName: 'gitlab_get_project',
          args: { project_id: projectId },
          description: 'Getting GitLab project details',
        };
      }
    }

    // List projects (default gitlab action)
    if (isListIntent && (isProject || (!isIssue && !isBranch && !isFile))) {
      const args: Record<string, unknown> = {};
      const searchMatch = text.match(/(?:search|filter|find|named?)\s+(\S+)/);
      if (searchMatch) args.search = searchMatch[1];
      return {
        toolName: 'gitlab_list_projects',
        args,
        description: 'Listing GitLab projects',
      };
    }
  }

  // --- GitHub tools ---

  // Create issue
  if (isCreateIntent && isIssue) {
    const title = extractTitle(input);
    if (ownerRepo && title) {
      return {
        toolName: 'github_create_issue',
        args: { owner: ownerRepo.owner, repo: ownerRepo.repo, title },
        description: 'Creating GitHub issue',
      };
    }
  }

  // List issues
  if (isListIntent && isIssue && ownerRepo) {
    const args: Record<string, unknown> = { owner: ownerRepo.owner, repo: ownerRepo.repo };
    if (text.includes('closed')) args.state = 'closed';
    else if (text.includes('all')) args.state = 'all';
    return {
      toolName: 'github_list_issues',
      args,
      description: 'Listing GitHub issues',
    };
  }

  // Get file
  if ((isReadIntent || isDetailIntent) && isFile && ownerRepo) {
    const filePath = extractFilePath(input);
    if (filePath) {
      return {
        toolName: 'github_get_file',
        args: { owner: ownerRepo.owner, repo: ownerRepo.repo, path: filePath },
        description: 'Reading file from GitHub repository',
      };
    }
  }

  // List branches
  if (isListIntent && isBranch && ownerRepo) {
    return {
      toolName: 'github_list_branches',
      args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
      description: 'Listing GitHub branches',
    };
  }

  // Get repo details
  if (isDetailIntent && isRepo && ownerRepo) {
    return {
      toolName: 'github_get_repo',
      args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
      description: 'Getting GitHub repository details',
    };
  }

  // Get repo (with owner/repo pattern, even without "detail" keyword)
  if (ownerRepo && isRepo && !isListIntent) {
    return {
      toolName: 'github_get_repo',
      args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
      description: 'Getting GitHub repository details',
    };
  }

  // List repos (most common / default github action)
  if (isListIntent && (isRepo || (!isIssue && !isBranch && !isFile && !isProject && platform !== 'gitlab'))) {
    const args: Record<string, unknown> = {};
    const username = extractUsername(input);
    if (username && !['me', 'my', 'mine'].includes(username)) {
      args.username = username;
    }
    return {
      toolName: 'github_list_repos',
      args,
      description: 'Listing GitHub repositories',
    };
  }

  // --- Fallback: try to match just based on owner/repo presence ---
  if (ownerRepo) {
    if (isBranch) {
      return {
        toolName: 'github_list_branches',
        args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
        description: 'Listing GitHub branches',
      };
    }
    if (isIssue) {
      return {
        toolName: 'github_list_issues',
        args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
        description: 'Listing GitHub issues',
      };
    }
    // Default: show repo info
    return {
      toolName: 'github_get_repo',
      args: { owner: ownerRepo.owner, repo: ownerRepo.repo },
      description: 'Getting GitHub repository details',
    };
  }

  return null;
}

/**
 * Generate help text showing available commands
 */
export function getHelpText(): string {
  return `**Available Commands:**

You can type natural language! Here are some examples:

**GitHub:**
- "show my repos" or "list repositories"
- "list repos for octocat"
- "tell me about repo facebook/react"
- "show branches of owner/repo"
- "read file README.md from owner/repo"
- "what are the issues in owner/repo"
- "show closed issues for owner/repo"
- "create issue in owner/repo titled "Bug title""

**GitLab:**
- "list gitlab projects"
- "show gitlab project 123"
- "list gitlab branches for 123"
- "read gitlab file src/main.ts from 123"
- "gitlab issues for my-group/my-project"
- "create gitlab issue in 123 titled "New feature""

**Other:**
- \`help\` — Show this help
- \`tools\` — List all available MCP tools
- Or use the **Tools** panel on the right to call any tool directly`;
}
