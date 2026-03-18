import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { Tool } from '@orbit-codes/nestjs-mcp';
import type {
  ListReposParams,
  GetRepoParams,
  ListBranchesParams,
  GetFileParams,
  ListIssuesParams,
  CreateIssueParams,
} from './github.types';

@Injectable()
export class GitHubService implements OnModuleInit {
  private readonly logger = new Logger(GitHubService.name);
  private octokit: Octokit;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const token = this.config.get<string>('GITHUB_TOKEN');
    this.octokit = new Octokit({ auth: token });
    this.logger.log('GitHub client initialized');
  }

  @Tool({
    name: 'github_list_repos',
    description:
      'List repositories for the authenticated GitHub user or a specific user/org. Returns repo names, visibility, default branch, and description.',
    parameters: {
      username: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listRepos(params: ListReposParams) {
    const { username, per_page: rawPerPage = 30, page = 1 } = params ?? {};
    const per_page = Math.min(Math.max(1, rawPerPage), 100);

    const response = username
      ? await this.octokit.repos.listForUser({ username, per_page, page })
      : await this.octokit.repos.listForAuthenticatedUser({
          per_page,
          page,
          sort: 'updated',
        });

    return JSON.stringify(
      response.data.map((r) => ({
        full_name: r.full_name,
        description: r.description,
        private: r.private,
        default_branch: r.default_branch,
        language: r.language,
        stargazers_count: r.stargazers_count,
        updated_at: r.updated_at,
        html_url: r.html_url,
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'github_get_repo',
    description:
      'Get detailed information about a specific GitHub repository including stats, topics, and license.',
    parameters: {
      owner: 'string',
      repo: 'string',
    },
  })
  async getRepo(params: GetRepoParams) {
    const { owner, repo } = params;
    const { data } = await this.octokit.repos.get({ owner, repo });

    return JSON.stringify(
      {
        full_name: data.full_name,
        description: data.description,
        private: data.private,
        default_branch: data.default_branch,
        language: data.language,
        stargazers_count: data.stargazers_count,
        forks_count: data.forks_count,
        open_issues_count: data.open_issues_count,
        topics: data.topics,
        license: data.license?.name,
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
        clone_url: data.clone_url,
      },
      null,
      2,
    );
  }

  @Tool({
    name: 'github_list_branches',
    description:
      'List branches in a GitHub repository. Returns branch names and their latest commit SHAs.',
    parameters: {
      owner: 'string',
      repo: 'string',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listBranches(params: ListBranchesParams) {
    const { owner, repo, per_page: rawPerPage = 30, page = 1 } = params;
    const per_page = Math.min(Math.max(1, rawPerPage), 100);
    const { data } = await this.octokit.repos.listBranches({
      owner,
      repo,
      per_page,
      page,
    });

    return JSON.stringify(
      data.map((b) => ({
        name: b.name,
        sha: b.commit.sha,
        protected: b.protected,
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'github_get_file',
    description:
      'Read the contents of a file from a GitHub repository. Returns the decoded file content as a string.',
    parameters: {
      owner: 'string',
      repo: 'string',
      path: 'string',
      ref: 'string?',
    },
  })
  async getFile(params: GetFileParams) {
    const { owner, repo, path, ref } = params;
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (Array.isArray(data)) {
      return JSON.stringify(
        data.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type,
          size: item.size,
          sha: item.sha,
        })),
        null,
        2,
      );
    }

    if (data.type !== 'file') {
      return JSON.stringify({
        error: `'${path}' is not a file`,
        type: data.type,
      });
    }

    const content = Buffer.from(
      (data as { content: string }).content,
      'base64',
    ).toString('utf-8');
    return JSON.stringify({ path: data.path, sha: data.sha, content }, null, 2);
  }

  @Tool({
    name: 'github_list_issues',
    description:
      'List issues in a GitHub repository. Supports filtering by state (open/closed/all) and labels.',
    parameters: {
      owner: 'string',
      repo: 'string',
      state: 'string?',
      labels: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listIssues(params: ListIssuesParams) {
    const {
      owner,
      repo,
      state = 'open',
      labels,
      per_page: rawPerPage = 20,
      page = 1,
    } = params;
    const per_page = Math.min(Math.max(1, rawPerPage), 100);
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state,
      labels,
      per_page,
      page,
    });

    return JSON.stringify(
      data.map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
        assignee: issue.assignee?.login,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        html_url: issue.html_url,
        body: issue.body?.substring(0, 500),
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'github_create_issue',
    description:
      'Create a new issue in a GitHub repository. Returns the created issue number and URL.',
    parameters: {
      owner: 'string',
      repo: 'string',
      title: 'string',
      body: 'string?',
      labels: 'string?',
      assignees: 'string?',
    },
  })
  async createIssue(params: CreateIssueParams) {
    const { owner, repo, title, body, labels, assignees } = params;

    const { data } = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
      labels: labels ? labels.split(',').map((l) => l.trim()) : undefined,
      assignees: assignees
        ? assignees.split(',').map((a) => a.trim())
        : undefined,
    });

    return JSON.stringify(
      {
        number: data.number,
        title: data.title,
        state: data.state,
        html_url: data.html_url,
        created_at: data.created_at,
      },
      null,
      2,
    );
  }
}
