/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Tool } from '@orbit-codes/nestjs-mcp';

@Injectable()
export class GitLabService implements OnModuleInit {
  private readonly logger = new Logger(GitLabService.name);
  private client: AxiosInstance;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const baseURL = `${this.config.get<string>('GITLAB_URL', 'https://gitlab.com')}/api/v4`;
    const token = this.config.get<string>('GITLAB_TOKEN');

    this.client = axios.create({
      baseURL,
      headers: { 'PRIVATE-TOKEN': token ?? '' },
    });

    this.logger.log(`GitLab client initialized for ${baseURL}`);
  }

  @Tool({
    name: 'gitlab_list_projects',
    description:
      'List GitLab projects accessible to the authenticated user. Supports search and membership filters.',
    parameters: {
      search: 'string?',
      membership: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listProjects(params: {
    search?: string;
    membership?: string;
    per_page?: number;
    page?: number;
  }) {
    const { search, membership, per_page = 20, page = 1 } = params ?? {};

    const { data } = await this.client.get('/projects', {
      params: {
        search,
        membership: membership === 'true' ? true : undefined,
        per_page,
        page,
        order_by: 'last_activity_at',
        sort: 'desc',
      },
    });

    return JSON.stringify(
      (data as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        path_with_namespace: p.path_with_namespace,
        description: p.description,
        visibility: p.visibility,
        default_branch: p.default_branch,
        last_activity_at: p.last_activity_at,
        web_url: p.web_url,
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'gitlab_get_project',
    description:
      'Get detailed information about a specific GitLab project by its numeric ID or "namespace/path".',
    parameters: {
      project_id: 'string',
    },
  })
  async getProject(params: { project_id: string }) {
    const encodedId = encodeURIComponent(params.project_id);
    const { data } = await this.client.get(`/projects/${encodedId}`);

    return JSON.stringify(
      {
        id: data.id,
        name: data.name,
        path_with_namespace: data.path_with_namespace,
        description: data.description,
        visibility: data.visibility,
        default_branch: data.default_branch,
        open_issues_count: data.open_issues_count,
        forks_count: data.forks_count,
        star_count: data.star_count,
        topics: data.topics,
        created_at: data.created_at,
        last_activity_at: data.last_activity_at,
        web_url: data.web_url,
        http_url_to_repo: data.http_url_to_repo,
      },
      null,
      2,
    );
  }

  @Tool({
    name: 'gitlab_list_branches',
    description:
      'List branches in a GitLab project. Returns branch names, latest commit info, and protection status.',
    parameters: {
      project_id: 'string',
      search: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listBranches(params: {
    project_id: string;
    search?: string;
    per_page?: number;
    page?: number;
  }) {
    const { project_id, search, per_page = 30, page = 1 } = params;
    const encodedId = encodeURIComponent(project_id);

    const { data } = await this.client.get(
      `/projects/${encodedId}/repository/branches`,
      { params: { search, per_page, page } },
    );

    return JSON.stringify(
      (data as any[]).map((b) => ({
        name: b.name,
        sha: b.commit?.id,
        commit_message: b.commit?.message?.split('\n')[0],
        committed_date: b.commit?.committed_date,
        protected: b.protected,
        default: b.default,
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'gitlab_get_file',
    description:
      'Read the contents of a file from a GitLab repository. Returns the decoded file content as a string.',
    parameters: {
      project_id: 'string',
      file_path: 'string',
      ref: 'string?',
    },
  })
  async getFile(params: {
    project_id: string;
    file_path: string;
    ref?: string;
  }) {
    const { project_id, file_path, ref = 'HEAD' } = params;
    const encodedId = encodeURIComponent(project_id);
    const encodedPath = encodeURIComponent(file_path);

    const { data } = await this.client.get(
      `/projects/${encodedId}/repository/files/${encodedPath}`,
      { params: { ref } },
    );

    const content = Buffer.from(data.content as string, 'base64').toString(
      'utf-8',
    );

    return JSON.stringify(
      {
        file_path: data.file_path,
        ref: data.ref,
        sha: data.blob_id,
        encoding: data.encoding,
        size: data.size,
        content,
      },
      null,
      2,
    );
  }

  @Tool({
    name: 'gitlab_list_issues',
    description:
      'List issues in a GitLab project. Supports filtering by state (opened/closed/all) and labels.',
    parameters: {
      project_id: 'string',
      state: 'string?',
      labels: 'string?',
      per_page: 'number?',
      page: 'number?',
    },
  })
  async listIssues(params: {
    project_id: string;
    state?: string;
    labels?: string;
    per_page?: number;
    page?: number;
  }) {
    const {
      project_id,
      state = 'opened',
      labels,
      per_page = 20,
      page = 1,
    } = params;
    const encodedId = encodeURIComponent(project_id);

    const { data } = await this.client.get(`/projects/${encodedId}/issues`, {
      params: { state, labels, per_page, page, order_by: 'updated_at' },
    });

    return JSON.stringify(
      (data as any[]).map((issue) => ({
        iid: issue.iid,
        title: issue.title,
        state: issue.state,
        labels: issue.labels,
        assignee: issue.assignee?.username,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        web_url: issue.web_url,
        description: issue.description?.substring(0, 500),
      })),
      null,
      2,
    );
  }

  @Tool({
    name: 'gitlab_create_issue',
    description:
      'Create a new issue in a GitLab project. Returns the created issue IID and URL.',
    parameters: {
      project_id: 'string',
      title: 'string',
      description: 'string?',
      labels: 'string?',
      assignee_ids: 'string?',
    },
  })
  async createIssue(params: {
    project_id: string;
    title: string;
    description?: string;
    labels?: string;
    assignee_ids?: string;
  }) {
    const { project_id, title, description, labels, assignee_ids } = params;
    const encodedId = encodeURIComponent(project_id);

    const payload: Record<string, unknown> = { title };
    if (description) payload.description = description;
    if (labels) payload.labels = labels;
    if (assignee_ids) {
      payload.assignee_ids = assignee_ids
        .split(',')
        .map((id) => parseInt(id.trim(), 10));
    }

    const { data } = await this.client.post(
      `/projects/${encodedId}/issues`,
      payload,
    );

    return JSON.stringify(
      {
        iid: data.iid,
        title: data.title,
        state: data.state,
        web_url: data.web_url,
        created_at: data.created_at,
      },
      null,
      2,
    );
  }
}
