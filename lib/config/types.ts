/**
 * Types for a loaded rules file: rules, their conditions and steps, and the whole config.
 *
 * Jira status, transition and message names are plain strings from the rules file.
 *
 * @module config/types
 */
import type { SyncOptions } from './syncOptions';

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
  /** Regex on deploy job names; capture group 1 = environment. Omit to use only the branch map. */
  jobNameRegex?: string;
  branchToEnvironment: Record<string, string>;
  environmentToJiraStatus: Record<string, string>;
};

/** Which GitHub URL `linkGithub` attaches as a Jira remote link. */
export type GithubLinkKind = 'pull_request' | 'workflow_run' | 'release';

/** Side effects after a step succeeds (`linkGithub` / `fields` on a rule). */
export type JiraStepExtras = {
  /** Add (or update) a Jira remote link to the PR, workflow run or release. */
  linkGithub?: GithubLinkKind;
  /** Jira field id → value template (supports `{placeholders}`). */
  fields?: Record<string, string>;
};

/** Rule action: move the issue to a named Jira status. */
export type TransitionStep = {
  kind: 'transition';
  status: string;
  /** Transition names to prefer when several lead to `status`. */
  via?: readonly string[];
  /** Overrides {@link SyncOptions.noTransitionMessageId} for this step only. */
  onNoTransition?: string;
  commentAfterSuccess?: string;
  commentWhenSkipped?: string;
  extras?: JiraStepExtras;
};

/** Rule action: infer the deploy environment from the workflow run and move the issue. */
export type DeployTransitionStep = {
  kind: 'deploy';
  onNoTransition?: string;
  commentAfterSuccess?: string;
  commentWhenSkipped?: string;
  extras?: JiraStepExtras;
};

/** Rule action: post a templated comment only. */
export type CommentStep = {
  kind: 'comment';
  /** Message template id from `messages`. */
  messageKey: string;
  extras?: JiraStepExtras;
};

/** Discriminated union of actions a rule can execute. */
export type RuleStep = TransitionStep | DeployTransitionStep | CommentStep;

/** A rule's `if:` conditions (plus its Jira status filters), compared against the event. */
export type RuleConditions = {
  action?: string | readonly string[];
  reviewState?: string | readonly string[];
  workflow?: string | readonly string[];
  /** workflow_run.event (e.g. pull_request vs push vs workflow_call) */
  runEvent?: string | readonly string[];
  conclusion?: string | readonly string[];
  merged?: boolean;
  draft?: boolean;
  /** pull_request.state (open vs closed) */
  prState?: string | readonly string[];
  /** `ifJiraStatus` in the rules file */
  jiraStatusIs?: string;
  /** `unlessJiraStatus` in the rules file */
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

/** One rule from the rules file. */
export type SyncRule = {
  /** `<event>:<slug of name>`, unique per config */
  id: string;
  /** Human-readable label (logs + debugging) */
  name: string;
  event: GitHubEventKind;
  when: RuleConditions;
  then: RuleStep;
};

/** A loaded and validated rules file. */
export type BuiltSyncConfig = {
  projectKey: string;
  messages: Record<string, string>;
  deploy: DeployMeta;
  rules: SyncRule[];
  options: SyncOptions;
};
