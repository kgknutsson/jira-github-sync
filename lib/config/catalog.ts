/**
 * GitHub vocabulary of the rules file: events (`when`), conditions (`if`), allowed values and
 * message placeholders.
 *
 * Single source for config validation (`configFile.ts`) and for the generated JSON Schema
 * (`jira-sync.config.schema.json`) that gives editors autocomplete for the rules file.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads
 * @module config/catalog
 */
import type { GitHubEventKind, GithubLinkKind } from './types';

/** Every event a rule can react to (`when:`), with a one-line description. */
export const EVENTS: Record<GitHubEventKind, string> = {
  pull_request: 'Pull request opened, updated, marked ready, converted to draft, closed, …',
  pull_request_review: 'Review submitted, edited or dismissed on a pull request.',
  workflow_run:
    'A GitHub Actions workflow finished (CI, deploy, …). Match it with the `workflow` condition.',
  check_suite:
    'Check suite completed. Third-party CI apps only: GitHub never triggers workflows for checks created by GitHub Actions.',
  check_run: 'Single check run completed. Third-party CI apps only, like check_suite.',
  issue_comment: 'Comment created, edited or deleted on an issue or pull request.',
  push: 'Commits pushed to a branch. Issue keys come from the commit messages and branch.',
  release: 'Release published, created, edited, …',
  merge_group: 'Merge queue checks requested, or merge group destroyed.',
  deployment_status: 'Deployment status reported for a GitHub Environment.',
};

/** Event names in declaration order. */
export const EVENT_NAMES = Object.keys(EVENTS) as GitHubEventKind[];

/** `action` values GitHub sends per event. Events without an entry have no `action` condition. */
export const EVENT_ACTIONS: Partial<Record<GitHubEventKind, readonly string[]>> = {
  pull_request: [
    'assigned',
    'auto_merge_disabled',
    'auto_merge_enabled',
    'closed',
    'converted_to_draft',
    'demilestoned',
    'dequeued',
    'edited',
    'enqueued',
    'labeled',
    'locked',
    'milestoned',
    'opened',
    'ready_for_review',
    'reopened',
    'review_request_removed',
    'review_requested',
    'synchronize',
    'unassigned',
    'unlabeled',
    'unlocked',
  ],
  pull_request_review: ['submitted', 'edited', 'dismissed'],
  check_suite: ['completed'],
  check_run: ['completed'],
  issue_comment: ['created', 'edited', 'deleted'],
  release: ['published', 'unpublished', 'created', 'edited', 'deleted', 'prereleased', 'released'],
  merge_group: ['checks_requested', 'destroyed'],
  deployment_status: ['created'],
};

/** Run and check conclusions (`workflow_run.conclusion`, `check_suite.conclusion`, …). */
export const CONCLUSIONS = [
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
] as const;

/** Conclusions a deploy "failed → comment" rule should list (checked by the rules audit). */
export const DEPLOY_FAIL_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'] as const;

/** Keys allowed under a rule's `if:`. */
export type ConditionKey =
  | 'action'
  | 'reviewState'
  | 'workflow'
  | 'runEvent'
  | 'conclusion'
  | 'prState'
  | 'merged'
  | 'draft'
  | 'baseRef'
  | 'headRef'
  | 'label'
  | 'notLabel'
  | 'author'
  | 'checkName'
  | 'deploymentEnvironment'
  | 'deploymentState'
  | 'releaseTag';

/** How one condition is validated and documented. */
export type ConditionSpec = {
  description: string;
  events: readonly GitHubEventKind[];
  type: 'string' | 'boolean';
  /** Allowed values; `'action'` = the per-event list in {@link EVENT_ACTIONS}; omitted = any string. */
  values?: readonly string[] | 'action';
};

const PR_EVENTS: readonly GitHubEventKind[] = ['pull_request', 'pull_request_review'];

/** Every `if:` condition: which events support it and which values it accepts. */
export const CONDITIONS: Record<ConditionKey, ConditionSpec> = {
  action: {
    description: 'Webhook action, e.g. opened, closed, submitted, published.',
    events: Object.keys(EVENT_ACTIONS) as GitHubEventKind[],
    type: 'string',
    values: 'action',
  },
  reviewState: {
    description: 'Review outcome.',
    events: ['pull_request_review'],
    type: 'string',
    values: ['approved', 'changes_requested', 'commented', 'dismissed'],
  },
  workflow: {
    description:
      'Workflow `name:` of the finished run. Also list it under on.workflow_run.workflows in the workflow file.',
    events: ['workflow_run'],
    type: 'string',
  },
  runEvent: {
    description: 'What triggered the run: pull_request, push, workflow_dispatch, schedule, …',
    events: ['workflow_run'],
    type: 'string',
  },
  conclusion: {
    description: 'Run or check result.',
    events: ['workflow_run', 'check_suite', 'check_run'],
    type: 'string',
    values: CONCLUSIONS,
  },
  prState: {
    description: 'Pull request state.',
    events: PR_EVENTS,
    type: 'string',
    values: ['open', 'closed'],
  },
  merged: {
    description: 'true for merged pull requests (use with action: closed).',
    events: ['pull_request'],
    type: 'boolean',
  },
  draft: {
    description: 'false for pull requests ready for review, true for drafts.',
    events: ['pull_request'],
    type: 'boolean',
  },
  baseRef: {
    description: 'Target branch, without refs/heads/.',
    events: [...PR_EVENTS, 'issue_comment', 'merge_group'],
    type: 'string',
  },
  headRef: {
    description: 'Source branch (push: the pushed branch), without refs/heads/.',
    events: [...PR_EVENTS, 'issue_comment', 'merge_group', 'push'],
    type: 'string',
  },
  label: {
    description: 'The pull request has at least one of these labels.',
    events: [...PR_EVENTS, 'issue_comment'],
    type: 'string',
  },
  notLabel: {
    description: 'The pull request has none of these labels (e.g. an opt-out label).',
    events: [...PR_EVENTS, 'issue_comment'],
    type: 'string',
  },
  author: {
    description: 'GitHub login of the pull request author.',
    events: PR_EVENTS,
    type: 'string',
  },
  checkName: {
    description: 'Check suite app name or check run name (third-party CI).',
    events: ['check_suite', 'check_run'],
    type: 'string',
  },
  deploymentEnvironment: {
    description: 'GitHub Environment name.',
    events: ['deployment_status'],
    type: 'string',
  },
  deploymentState: {
    description: 'Deployment status.',
    events: ['deployment_status'],
    type: 'string',
    values: ['success', 'failure', 'error', 'pending', 'inactive', 'in_progress', 'queued'],
  },
  releaseTag: {
    description: 'Release tag name, e.g. v1.2.0 (quote numbers).',
    events: ['release'],
    type: 'string',
  },
};

/** Events that carry the URL each `linkGithub` kind attaches. */
export const LINK_KINDS: Record<GithubLinkKind, readonly GitHubEventKind[]> = {
  pull_request: ['pull_request', 'pull_request_review', 'issue_comment'],
  workflow_run: ['workflow_run'],
  release: ['release'],
};

/** Placeholders available in message templates and `fields` values. */
export const PLACEHOLDERS: Record<string, string> = {
  issueKey: 'Jira issue key, e.g. PROJ-123',
  url: 'Main link: PR, workflow run, release, comment, or commit/checks page',
  prUrl: 'Pull request URL (pull_request, pull_request_review, PR comments)',
  baseRef: 'Target branch',
  headRef: 'Source or pushed branch',
  currentStatus: 'Jira status when the rule matched',
  targetStatus: 'Status a transition or deploy step moves to',
  status: 'Target status in transition/deploy comments; current status in comment rules',
  env: 'Deploy environment (deploy steps) or GitHub Environment (deployment_status)',
  workflowName: 'Workflow name (workflow_run)',
  runEvent: 'What triggered the workflow run',
  conclusion: 'Run or check conclusion',
  checkName: 'Check name',
  author: 'Pull request author login',
  labels: 'Comma-separated pull request labels',
  releaseTag: 'Release tag',
  releaseName: 'Release name',
  ref: 'Pushed ref (push)',
  deploymentState: 'Deployment state (deployment_status)',
};
