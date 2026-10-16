/**
 * First-match rule selection against GitHub event context and current Jira status.
 *
 * @module engine/matchRule
 */
import type { BuiltSyncConfig, RuleConditions, SyncRule } from '../config/types';
import type { PullRequestRef } from '../adapters/github/types';
import type { SyncEventContext } from './types';

function matchValue(
  actual: string | boolean | undefined,
  expected: string | readonly string[] | boolean | undefined
): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'boolean') return actual === expected;
  if (Array.isArray(expected)) {
    return typeof actual === 'string' && expected.includes(actual);
  }
  return actual === expected;
}

function prLabels(pr: PullRequestRef): string[] {
  return pr.labels ?? [];
}

function matchLabels(pr: PullRequestRef, when: RuleConditions): boolean {
  if (when.label !== undefined) {
    const want = Array.isArray(when.label) ? when.label : [when.label];
    if (!want.some((l) => prLabels(pr).includes(l))) return false;
  }
  if (when.notLabel !== undefined) {
    const block = Array.isArray(when.notLabel) ? when.notLabel : [when.notLabel];
    if (block.some((l) => prLabels(pr).includes(l))) return false;
  }
  return true;
}

/** Returns whether `when` conditions match the given event and Jira column. */
export function conditionsMatch(
  when: RuleConditions,
  ctx: SyncEventContext,
  jiraStatus: string | null
): boolean {
  if (ctx.event === 'pull_request') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.pr.merged, when.merged)) return false;
    if (!matchValue(ctx.pr.state, when.prState)) return false;
    if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
    if (!matchValue(ctx.pr.authorLogin, when.author)) return false;
    if (!matchLabels(ctx.pr, when)) return false;
    if (when.notDraft && ctx.pr.draft) return false;
    if (when.draft !== undefined && ctx.pr.draft !== when.draft) return false;
  }

  if (ctx.event === 'pull_request_review') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.reviewState, when.reviewState)) return false;
    if (!matchValue(ctx.pr.state, when.prState)) return false;
    if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
    if (!matchValue(ctx.pr.authorLogin, when.author)) return false;
    if (!matchLabels(ctx.pr, when)) return false;
  }

  if (ctx.event === 'workflow_run') {
    if (!matchValue(ctx.workflowName, when.workflow)) return false;
    if (!matchValue(ctx.runEvent, when.runEvent)) return false;
    if (!matchValue(ctx.conclusion ?? undefined, when.conclusion)) return false;
  }

  if (ctx.event === 'check_suite' || ctx.event === 'check_run') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.checkName, when.checkName)) return false;
    if (!matchValue(ctx.conclusion ?? undefined, when.conclusion)) return false;
  }

  if (ctx.event === 'issue_comment') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (ctx.pr) {
      if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
      if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
      if (!matchLabels(ctx.pr, when)) return false;
    } else if (
      when.baseRef !== undefined ||
      when.headRef !== undefined ||
      when.label !== undefined
    ) {
      return false;
    }
  }

  if (ctx.event === 'push') {
    const branch = ctx.ref.replace(/^refs\/heads\//, '');
    if (!matchValue(branch, when.headRef)) return false;
  }

  if (ctx.event === 'release') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.tagName, when.releaseTag)) return false;
  }

  if (ctx.event === 'merge_group') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.headRef, when.headRef)) return false;
  }

  if (ctx.event === 'deployment_status') {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.environment, when.deploymentEnvironment)) return false;
    if (!matchValue(ctx.state, when.deploymentState)) return false;
  }

  if (when.jiraStatusIs && jiraStatus !== when.jiraStatusIs) return false;
  if (when.jiraStatusIsNot && jiraStatus === when.jiraStatusIsNot) return false;

  return true;
}

/** First rule in config order whose event and conditions match (or `null`). */
export function findMatchingRule(
  config: BuiltSyncConfig,
  ctx: SyncEventContext,
  jiraStatus: string | null
): SyncRule | null {
  for (const rule of config.rules) {
    if (rule.event !== ctx.event) continue;
    if (conditionsMatch(rule.when, ctx, jiraStatus)) return rule;
  }
  return null;
}
