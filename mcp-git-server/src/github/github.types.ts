export interface ListReposParams {
  username?: string;
  per_page?: number;
  page?: number;
}

export interface GetRepoParams {
  owner: string;
  repo: string;
}

export interface ListBranchesParams {
  owner: string;
  repo: string;
  per_page?: number;
  page?: number;
}

export interface GetFileParams {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export interface ListIssuesParams {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  per_page?: number;
  page?: number;
}

export interface CreateIssueParams {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string;
  assignees?: string;
}
