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

type PullRequestApiItem = {
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  draft?: boolean;
  state: 'open' | 'closed';
  /** `repo` is `null` when the head (fork) repository was deleted. */
  head: { ref: string; sha?: string; repo: { full_name: string } | null };
  base: { ref: string };
  labels?: { name: string }[];
  user?: { login?: string } | null;
};

function pullRequestFromApi(pr: PullRequestApiItem): PullRequestRef {
  return {
    title: pr.title,
    headRef: pr.head.ref,
    body: pr.body,
    htmlUrl: pr.html_url,
    merged: pr.merged_at != null,
    draft: pr.draft ?? false,
    state: pr.state,
    baseRef: pr.base.ref,
    headRepoFullName: pr.head.repo?.full_name ?? '',
    labels: (pr.labels ?? []).map((l) => l.name),
    authorLogin: pr.user?.login ?? '',
    ...(pr.head.sha ? { headSha: pr.head.sha } : {}),
  };
}

/** PRs GitHub associates with a commit SHA (for deploy / QG issue-key lookup). */
export async function findPullRequestsForCommit(
  auth: GitHubAuth,
  commitSha: string
): Promise<PullRequestRef[]> {
  const [owner, repo] = auth.repository.split('/');
  if (!owner || !repo) return [];

  const pulls = await githubApiGet<PullRequestApiItem[]>(
    auth,
    `/repos/${owner}/${repo}/commits/${commitSha}/pulls`
  );
  return pulls.map(pullRequestFromApi);
}

/** One pull request by number (PR details for `issue_comment` events). */
export async function getPullRequest(
  auth: GitHubAuth,
  pullNumber: number
): Promise<PullRequestRef | null> {
  const [owner, repo] = auth.repository.split('/');
  if (!owner || !repo) return null;

  const pr = await githubApiGet<PullRequestApiItem>(
    auth,
    `/repos/${owner}/${repo}/pulls/${pullNumber}`
  );
  return pullRequestFromApi(pr);
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

/**
 * `true` when the PR head branch lives in the workflow repository; `false` for fork PRs
 * (including forks whose repository was deleted).
 */
export function isFromSameRepository(pr: PullRequestRef, repository: string): boolean {
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
