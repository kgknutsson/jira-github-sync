/**
 * Normalized event contexts built by `eventContext.ts` and passed into the sync engine.
 *
 * @module engine/types
 */
import type { PullRequestRef } from '../adapters/github/types';

export type PullRequestContext = {
  event: 'pull_request';
  action: string;
  pr: PullRequestRef;
  repository: string;
  url: string;
};

export type PullRequestReviewContext = {
  event: 'pull_request_review';
  action: string;
  reviewState: string;
  pr: PullRequestRef;
  repository: string;
  url: string;
};

export type WorkflowRunContext = {
  event: 'workflow_run';
  workflowName: string;
  runEvent: string;
  conclusion: string | null;
  headSha: string;
  headBranch: string;
  runUrl: string;
  runId: number;
  repository: string;
};

export type CheckSuiteContext = {
  event: 'check_suite';
  action: string;
  conclusion: string | null;
  checkName: string;
  headSha: string;
  headBranch: string;
  repository: string;
};

export type CheckRunContext = {
  event: 'check_run';
  action: string;
  conclusion: string | null;
  checkName: string;
  headSha: string;
  headBranch: string;
  checkUrl: string;
  repository: string;
};

export type IssueCommentContext = {
  event: 'issue_comment';
  action: string;
  body: string;
  /** PR number when the comment is on a pull request (`null` for plain issues). */
  pullRequestNumber: number | null;
  /** PR details, fetched by the engine for PR comments (the webhook payload has none). */
  pr: PullRequestRef | null;
  repository: string;
  url: string;
};

export type PushContext = {
  event: 'push';
  ref: string;
  headSha: string;
  commitMessages: string[];
  /** Commits included in the push webhook (`id` + message). */
  commits: { sha: string; message: string }[];
  repository: string;
};

export type ReleaseContext = {
  event: 'release';
  action: string;
  tagName: string;
  releaseName: string;
  releaseUrl: string;
  repository: string;
};

export type MergeGroupContext = {
  event: 'merge_group';
  action: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  /** Head commit message of the merge group (carries the queued PR titles). */
  commitMessage: string;
  repository: string;
};

export type DeploymentStatusContext = {
  event: 'deployment_status';
  action: string;
  environment: string;
  state: string;
  deploymentUrl: string;
  headSha: string;
  ref: string;
  repository: string;
};

export type SyncEventContext =
  | PullRequestContext
  | PullRequestReviewContext
  | WorkflowRunContext
  | CheckSuiteContext
  | CheckRunContext
  | IssueCommentContext
  | PushContext
  | ReleaseContext
  | MergeGroupContext
  | DeploymentStatusContext;

/** Contexts that carry an optional PR (for linking / baseRef in templates). */
export type ContextWithOptionalPr = Extract<
  SyncEventContext,
  { pr?: PullRequestRef | null } | { pr: PullRequestRef }
>;
