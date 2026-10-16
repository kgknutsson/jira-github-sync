/**
 * GitHub REST helpers for PR lookup, workflow jobs, and commit messages.
 *
 * Uses `GITHUB_TOKEN` and `GITHUB_REPOSITORY` from the Actions environment.
 *
 * @module adapters/github/api
 */
import type { GitHubAuth, PullRequestRef } from './types';

/** Returns GitHub auth from Actions env, or `null` outside Actions. */
export function readGitHubAuthFromEnv(): GitHubAuth | null {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  return { token, repository };
}

async function githubApiGet<T>(auth: GitHubAuth, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${auth.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

/** PRs GitHub associates with a commit SHA (for deploy / QG issue-key lookup). */
export async function findPullRequestsForCommit(
  auth: GitHubAuth,
  commitSha: string
): Promise<PullRequestRef[]> {
  const [owner, repo] = auth.repository.split('/');
  if (!owner || !repo) return [];

  type PrListItem = {
    title: string;
    body: string | null;
    html_url: string;
    merged_at: string | null;
    draft: boolean;
    state: 'open' | 'closed';
    head: { ref: string; repo: { full_name: string } };
    base: { ref: string };
  };

  const pulls = await githubApiGet<PrListItem[]>(
    auth,
    `/repos/${owner}/${repo}/commits/${commitSha}/pulls`
  );

  return pulls.map((pr) => ({
    title: pr.title,
    headRef: pr.head.ref,
    body: pr.body,
    htmlUrl: pr.html_url,
    merged: pr.merged_at != null,
    draft: pr.draft,
    state: pr.state,
    baseRef: pr.base.ref,
    headRepoFullName: pr.head.repo.full_name,
    labels: [],
    authorLogin: '',
  }));
}

/** Job names for a workflow run (used to parse deploy environment). */
export async function listWorkflowRunJobs(
  auth: GitHubAuth,
  runId: number
): Promise<{ name: string }[]> {
  const [owner, repo] = auth.repository.split('/');
  if (!owner || !repo) return [];

  type JobsResponse = { jobs?: { name: string }[] };
  const data = await githubApiGet<JobsResponse>(
    auth,
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`
  );
  return data.jobs ?? [];
}

/** `false` when the PR head repo differs from the workflow repository (fork PR). */
export function isSameRepositoryFork(pr: PullRequestRef, repository: string): boolean {
  return pr.headRepoFullName === repository;
}

/** Full commit message for `headSha` (issue-key fallback on push deploys). */
export async function getCommitMessage(
  auth: GitHubAuth,
  commitSha: string
): Promise<string | null> {
  const [owner, repo] = auth.repository.split('/');
  if (!owner || !repo) return null;

  type CommitResponse = { commit?: { message?: string } };
  const data = await githubApiGet<CommitResponse>(
    auth,
    `/repos/${owner}/${repo}/commits/${commitSha}`
  );
  return data.commit?.message ?? null;
}
