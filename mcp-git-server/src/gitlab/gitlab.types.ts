export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  description: string;
  visibility: string;
  default_branch: string;
  last_activity_at: string;
  web_url: string;
}

export interface GitLabProjectDetail extends GitLabProject {
  open_issues_count: number;
  forks_count: number;
  star_count: number;
  topics: string[];
  created_at: string;
  http_url_to_repo: string;
}

export interface GitLabBranch {
  name: string;
  commit?: {
    id: string;
    message?: string;
    committed_date?: string;
  };
  protected?: boolean;
  default?: boolean;
}

export interface GitLabFile {
  content: string;
  file_path: string;
  ref: string;
  blob_id: string;
  encoding: string;
  size: number;
}

export interface GitLabIssue {
  iid: number;
  title: string;
  state: string;
  labels: string[];
  assignee?: { username: string };
  created_at: string;
  updated_at: string;
  web_url: string;
  description?: string;
}

export interface GitLabCreatedIssue {
  iid: number;
  title: string;
  state: string;
  web_url: string;
  created_at: string;
}
