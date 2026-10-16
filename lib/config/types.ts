/**
 * Type definitions for sync rules, steps, and built configuration.
 *
 * GitHub webhook fields use fixed shapes; Jira {@link JiraStatusName} and
 * {@link JiraTransitionName} are always opaque strings from `settings.ts`.
 *
 * @module config/types
 */
import type { JiraStepExtras } from './jiraStepExtras';
import type { JiraStatusName, JiraTransitionName } from './jiraConfigLabels';
import type { SyncOptions } from './syncOptions';

export type { JiraStatusName, JiraTransitionName };
export type { GithubLinkKind, JiraStepExtras } from './jiraStepExtras';

/** GitHub webhook kinds supported by the rule engine. */
export type GitHubEventKind =
  | 'pull_request'
  | 'pull_request_review'
  | 'workflow_run'
  | 'check_suite'
  | 'check_run'
  | 'issue_comment'
  | 'push'
  | 'release'
  | 'merge_group'
  | 'deployment_status';

/** Maps deploy workflow jobs / branches to Jira deploy columns. */
export type DeployMeta = {
  jobNameRegex: string;
  branchToEnvironment: Record<string, string>;
  environmentToJiraStatus: Record<string, string>;
};

/**
 * Message template id (key in `settings.ts` `.messages({ ... })`).
 * Always a plain string — not defined in `syncCatalog`.
 */
export type MessageTemplateId = string;

/** Rule action: move issue to a named Jira status column. */
export type TransitionStep = {
  kind: 'transition';
  status: JiraStatusName;
  via?: readonly JiraTransitionName[];
  /** Overrides {@link SyncOptions.noTransitionMessageId} for this step only. */
  onNoTransition?: MessageTemplateId;
  commentAfterSuccess?: MessageTemplateId;
  commentWhenSkipped?: MessageTemplateId;
  extras?: JiraStepExtras;
};

/** Rule action: infer deploy env from workflow run and transition accordingly. */
export type DeployTransitionStep = {
  kind: 'deploy';
  onNoTransition?: MessageTemplateId;
  commentAfterSuccess?: MessageTemplateId;
  commentWhenSkipped?: MessageTemplateId;
  extras?: JiraStepExtras;
};

/** Rule action: post a templated comment only. */
export type CommentStep = {
  kind: 'comment';
  messageKey: MessageTemplateId;
  extras?: JiraStepExtras;
};

/** Discriminated union of actions a rule can execute. */
export type RuleStep = TransitionStep | DeployTransitionStep | CommentStep;

/** `when` clause fields compared against the GitHub event (+ optional Jira status). */
export type RuleConditions = {
  action?: string | readonly string[];
  reviewState?: string | readonly string[];
  workflow?: string | readonly string[];
  /** workflow_run.event (e.g. pull_request vs push vs workflow_call) */
  runEvent?: string | readonly string[];
  conclusion?: string | readonly string[];
  merged?: boolean;
  draft?: boolean;
  notDraft?: boolean;
  /** pull_request.state (open vs closed) */
  prState?: 'open' | 'closed' | readonly ('open' | 'closed')[];
  jiraStatusIs?: string;
  jiraStatusIsNot?: string;
  /** PR base branch (pull_request, review, PR comment) or merge_group base branch */
  baseRef?: string | readonly string[];
  /** PR head branch, push branch, or merge_group head branch */
  headRef?: string | readonly string[];
  /** pull_request label name (any match) */
  label?: string | readonly string[];
  /** pull_request must not have this label */
  notLabel?: string | readonly string[];
  /** GitHub login of PR author */
  author?: string | readonly string[];
  /** check_suite / check_run name or app name */
  checkName?: string | readonly string[];
  /** GitHub deployment environment name */
  deploymentEnvironment?: string | readonly string[];
  /** deployment_status.state (success, failure, …) */
  deploymentState?: string | readonly string[];
  /** release.tag_name */
  releaseTag?: string | readonly string[];
};

/** One if-this-then-that rule in `settings.ts`. */
export type SyncRule = {
  id: string;
  /** Human-readable label (logs + debugging) */
  name: string;
  event: GitHubEventKind;
  when: RuleConditions;
  then: RuleStep;
};

/** Output of `config(projectKey).…build()` in `settings.ts`. */
export type BuiltSyncConfig = {
  projectKey: string;
  messages: Record<string, string>;
  deploy: DeployMeta;
  rules: SyncRule[];
  options: SyncOptions;
};
