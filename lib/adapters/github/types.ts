/**
 * GitHub-side types shared by parseEvent and the REST adapter.
 *
 * @module adapters/github/types
 */

/** Subset of pull_request fields needed for issue-key extraction and fork checks. */
export type PullRequestRef = {
  title: string;
  headRef: string;
  body: string | null;
  htmlUrl: string;
  merged: boolean;
  draft: boolean;
  /** GitHub pull_request.state */
  state: 'open' | 'closed';
  baseRef: string;
  headRepoFullName: string;
  labels: string[];
  authorLogin: string;
};

/** `GITHUB_TOKEN` + `GITHUB_REPOSITORY` from Actions. */
export type GitHubAuth = {
  token: string;
  repository: string;
};
