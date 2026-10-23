/**
 * Maps raw GitHub webhook JSON (`GITHUB_EVENT_PATH`) to typed sync contexts.
 *
 * @module adapters/github/parseEvent
 */
import type { PullRequestRef } from './types';

type WorkflowRunPayload = {
  name: string;
  event: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  html_url: string;
  id: number;
};

type PullRequestPayload = {
  title: string;
  body: string | null;
  html_url: string;
  merged?: boolean;
  merged_at?: string | null;
  draft: boolean;
  state?: 'open' | 'closed';
  /** `repo` is `null` when the head (fork) repository was deleted. */
  head: { ref: string; repo: { full_name: string } | null };
  base: { ref: string };
  labels?: { name: string }[];
  user?: { login?: string };
};

function stripHeadsPrefix(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

function pullRequestFromPayload(pr: PullRequestPayload): PullRequestRef {
  const merged = pr.merged ?? (pr.merged_at != null && pr.merged_at !== '');
  return {
    title: pr.title,
    headRef: pr.head.ref,
    body: pr.body,
    htmlUrl: pr.html_url,
    merged,
    draft: pr.draft,
    state: pr.state === 'closed' ? 'closed' : 'open',
    baseRef: pr.base.ref,
    headRepoFullName: pr.head.repo?.full_name ?? '',
    labels: (pr.labels ?? []).map((l) => l.name),
    authorLogin: pr.user?.login ?? '',
  };
}

/** Discriminated union returned by {@link parseGitHubEvent}. */
export type ParsedGitHubEvent =
  | { kind: 'pull_request'; action: string; pr: PullRequestRef }
  | {
      kind: 'pull_request_review';
      action: string;
      reviewState: string;
      pr: PullRequestRef;
    }
  | {
      kind: 'workflow_run';
      workflowName: string;
      runEvent: string;
      conclusion: string | null;
      headSha: string;
      headBranch: string;
      runUrl: string;
      runId: number;
    }
  | {
      kind: 'check_suite';
      action: string;
      conclusion: string | null;
      checkName: string;
      headSha: string;
      headBranch: string;
    }
  | {
      kind: 'check_run';
      action: string;
      conclusion: string | null;
      checkName: string;
      headSha: string;
      headBranch: string;
      checkUrl: string;
    }
  | {
      kind: 'issue_comment';
      action: string;
      body: string;
      /** Set when the comment is on a pull request (the payload carries no PR details). */
      pullRequestNumber: number | null;
      commentUrl: string;
    }
  | {
      kind: 'push';
      ref: string;
      headSha: string;
      commitMessages: string[];
      commits: { sha: string; message: string }[];
    }
  | {
      kind: 'release';
      action: string;
      tagName: string;
      releaseName: string;
      releaseUrl: string;
    }
  | {
      kind: 'merge_group';
      action: string;
      headRef: string;
      headSha: string;
      baseRef: string;
      commitMessage: string;
    }
  | {
      kind: 'deployment_status';
      action: string;
      environment: string;
      state: string;
      deploymentUrl: string;
      headSha: string;
      ref: string;
    };

/**
 * Parses a webhook payload for supported event names.
 *
 * @returns Normalized event or `null` if unsupported / malformed
 */
export function parseGitHubEvent(eventName: string, payload: unknown): ParsedGitHubEvent | null {
  if (eventName === 'pull_request') {
    const p = payload as { action?: string; pull_request?: PullRequestPayload };
    if (!p.action || !p.pull_request) return null;
    return {
      kind: 'pull_request',
      action: p.action,
      pr: pullRequestFromPayload(p.pull_request),
    };
  }

  if (eventName === 'pull_request_review') {
    const p = payload as {
      action?: string;
      review?: { state?: string };
      pull_request?: PullRequestPayload;
    };
    if (!p.action || !p.review?.state || !p.pull_request) return null;
    return {
      kind: 'pull_request_review',
      action: p.action,
      reviewState: p.review.state,
      pr: pullRequestFromPayload(p.pull_request),
    };
  }

  if (eventName === 'workflow_run') {
    const p = payload as { workflow_run?: WorkflowRunPayload };
    const run = p.workflow_run;
    if (!run) return null;
    return {
      kind: 'workflow_run',
      workflowName: run.name,
      runEvent: run.event ?? 'unknown',
      conclusion: run.conclusion ?? null,
      headSha: run.head_sha,
      headBranch: run.head_branch ?? '',
      runUrl: run.html_url,
      runId: run.id,
    };
  }

  if (eventName === 'check_suite') {
    const p = payload as {
      action?: string;
      check_suite?: {
        conclusion?: string | null;
        head_sha?: string;
        head_branch?: string | null;
        app?: { name?: string };
      };
    };
    const suite = p.check_suite;
    if (!p.action || !suite?.head_sha) return null;
    return {
      kind: 'check_suite',
      action: p.action,
      conclusion: suite.conclusion ?? null,
      checkName: suite.app?.name ?? 'check_suite',
      headSha: suite.head_sha,
      headBranch: suite.head_branch ?? '',
    };
  }

  if (eventName === 'check_run') {
    const p = payload as {
      action?: string;
      check_run?: {
        conclusion?: string | null;
        name?: string;
        head_sha?: string;
        html_url?: string;
        check_suite?: { head_branch?: string | null };
      };
    };
    const run = p.check_run;
    if (!p.action || !run?.head_sha) return null;
    return {
      kind: 'check_run',
      action: p.action,
      conclusion: run.conclusion ?? null,
      checkName: run.name ?? 'check_run',
      headSha: run.head_sha,
      headBranch: run.check_suite?.head_branch ?? '',
      checkUrl: run.html_url ?? '',
    };
  }

  if (eventName === 'issue_comment') {
    const p = payload as {
      action?: string;
      comment?: { body?: string; html_url?: string };
      issue?: { number?: number; pull_request?: unknown };
    };
    if (!p.action || !p.comment?.body) return null;
    const issueNumber = p.issue?.number;
    const onPullRequest = p.issue?.pull_request != null && typeof issueNumber === 'number';
    return {
      kind: 'issue_comment',
      action: p.action,
      body: p.comment.body,
      pullRequestNumber: onPullRequest ? issueNumber : null,
      commentUrl: p.comment.html_url ?? '',
    };
  }

  if (eventName === 'push') {
    const p = payload as {
      ref?: string;
      after?: string;
      commits?: { id?: string; message?: string }[];
    };
    if (!p.ref || !p.after) return null;
    const commits = (p.commits ?? [])
      .filter((c) => c.id)
      .map((c) => ({ sha: c.id!, message: c.message ?? '' }));
    return {
      kind: 'push',
      ref: p.ref,
      headSha: p.after,
      commitMessages: commits.map((c) => c.message),
      commits,
    };
  }

  if (eventName === 'release') {
    const p = payload as {
      action?: string;
      release?: { tag_name?: string; name?: string | null; html_url?: string };
    };
    if (!p.action || !p.release?.tag_name) return null;
    return {
      kind: 'release',
      action: p.action,
      tagName: p.release.tag_name,
      releaseName: p.release.name || p.release.tag_name,
      releaseUrl: p.release.html_url ?? '',
    };
  }

  if (eventName === 'merge_group') {
    const p = payload as {
      action?: string;
      merge_group?: {
        head_ref?: string;
        head_sha?: string;
        base_ref?: string;
        head_commit?: { message?: string } | null;
      };
    };
    const mg = p.merge_group;
    if (!p.action || !mg?.head_sha) return null;
    return {
      kind: 'merge_group',
      action: p.action,
      headRef: stripHeadsPrefix(mg.head_ref ?? ''),
      headSha: mg.head_sha,
      baseRef: stripHeadsPrefix(mg.base_ref ?? ''),
      commitMessage: mg.head_commit?.message ?? '',
    };
  }

  if (eventName === 'deployment_status') {
    const p = payload as {
      action?: string;
      deployment_status?: { state?: string; environment_url?: string };
      deployment?: { environment?: string; sha?: string; ref?: string };
    };
    const dep = p.deployment;
    const st = p.deployment_status;
    if (!p.action || !dep?.environment || !st?.state) return null;
    return {
      kind: 'deployment_status',
      action: p.action,
      environment: dep.environment,
      state: st.state,
      deploymentUrl: st.environment_url ?? '',
      headSha: dep.sha ?? '',
      ref: dep.ref ?? '',
    };
  }

  return null;
}
