/**
 * Orchestrates a single GitHub event: resolve issue keys, match rules, run actions.
 *
 * @module engine/runSync
 */
import {
  findPullRequestsForCommit,
  getCommitMessage,
  getPullRequest,
  isFromSameRepository,
  readGitHubAuthFromEnv,
} from '../adapters/github/api';
import {
  getIssueStatusName,
  JiraIssueNotFoundError,
  missingJiraCredentials,
  readJiraConfigFromEnv,
} from '../adapters/jira/client';
import { executeAction } from '../actions/executeAction';
import { resolveIssueKeysForWorkflowRun } from '../actions/deployAction';
import type { CompiledSyncConfig } from '../config/compileConfig';
import { createIssueKeyExtractor, textContainsSkipMarker } from '../utils/issueKey';
import { log } from '../utils/logger';
import { findMatchingRule } from './matchRule';
import type {
  CheckRunContext,
  CheckSuiteContext,
  PullRequestContext,
  PullRequestReviewContext,
  SyncEventContext,
  WorkflowRunContext,
} from './types';

const TERMINAL_CONCLUSIONS = new Set([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
]);

function shouldProcessTerminalConclusion(
  label: string,
  conclusion: string | null,
  action: string
): boolean {
  if (action !== 'completed') {
    log.info(`${label} action "${action}" not handled; skipping`);
    return false;
  }
  if (conclusion == null || conclusion === '') {
    log.info(`${label} has no conclusion yet; skipping`);
    return false;
  }
  if (!TERMINAL_CONCLUSIONS.has(conclusion)) {
    log.info(`${label} conclusion "${conclusion}" not handled; skipping`);
    return false;
  }
  return true;
}

function shouldProcessWorkflowRun(ctx: WorkflowRunContext): boolean {
  return shouldProcessTerminalConclusion('workflow_run', ctx.conclusion, 'completed');
}

function shouldProcessCheck(ctx: CheckSuiteContext | CheckRunContext): boolean {
  return shouldProcessTerminalConclusion(ctx.event, ctx.conclusion, ctx.action);
}

/** Fills `pr` on PR comments: the `issue_comment` payload only carries the PR number. */
async function withPullRequest(ctx: SyncEventContext): Promise<SyncEventContext> {
  if (ctx.event !== 'issue_comment' || ctx.pr || ctx.pullRequestNumber == null) return ctx;
  const gh = readGitHubAuthFromEnv();
  if (!gh) {
    log.info('GITHUB_TOKEN not set; PR comment handled without PR details');
    return ctx;
  }
  return { ...ctx, pr: await getPullRequest(gh, ctx.pullRequestNumber) };
}

function skipTextsForPullRequest(ctx: PullRequestContext | PullRequestReviewContext): string[] {
  return [ctx.pr.title, ctx.pr.body ?? '', ctx.pr.headRef];
}

async function skipTextsForSha(headSha: string, headBranch: string): Promise<string[]> {
  const texts: string[] = [headBranch];
  const gh = readGitHubAuthFromEnv();
  if (!gh) return texts;

  const prs = await findPullRequestsForCommit(gh, headSha);
  for (const pr of prs) {
    texts.push(pr.title, pr.body ?? '', pr.headRef);
  }

  try {
    texts.push((await getCommitMessage(gh, headSha)) ?? '');
  } catch (err) {
    log.info('Could not read commit message for skip-marker check', err);
  }

  return texts;
}

async function skipTextsForContext(ctx: SyncEventContext): Promise<string[]> {
  switch (ctx.event) {
    case 'pull_request':
    case 'pull_request_review':
      return skipTextsForPullRequest(ctx);
    case 'workflow_run':
      return skipTextsForSha(ctx.headSha, ctx.headBranch);
    case 'check_suite':
    case 'check_run':
      return skipTextsForSha(ctx.headSha, ctx.headBranch);
    case 'deployment_status':
      return skipTextsForSha(ctx.headSha, ctx.ref.replace(/^refs\/heads\//, ''));
    case 'issue_comment':
      return [
        ctx.body,
        ctx.pr?.title ?? '',
        ctx.pr?.body ?? '',
        ctx.pr?.headRef ?? '',
      ];
    case 'push':
      return [...ctx.commitMessages, ctx.ref];
    case 'release':
      return [ctx.tagName, ctx.releaseName];
    case 'merge_group':
      return [ctx.commitMessage, ctx.headRef, ctx.baseRef];
    default:
      return [];
  }
}

async function resolveIssueKeys(
  compiled: CompiledSyncConfig,
  ctx: SyncEventContext
): Promise<string[]> {
  const keyExtractor = createIssueKeyExtractor(compiled.issueKeyPattern);

  if (
    ctx.event === 'workflow_run' ||
    ctx.event === 'check_suite' ||
    ctx.event === 'check_run' ||
    ctx.event === 'deployment_status'
  ) {
    const branch =
      ctx.event === 'deployment_status'
        ? ctx.ref.replace(/^refs\/heads\//, '')
        : ctx.headBranch;
    return resolveIssueKeysForWorkflowRun(
      ctx.headSha,
      branch,
      (parts) => keyExtractor.extractAll(parts),
      { resolveKeyFromCommitMessage: compiled.options.resolveKeyFromCommitMessage }
    );
  }

  if (ctx.event === 'push') {
    const branch = ctx.ref.replace(/^refs\/heads\//, '');
    return keyExtractor.extractAll({
      branch,
      commitMessage: ctx.commitMessages.join('\n'),
    });
  }

  if (ctx.event === 'issue_comment') {
    if (ctx.pr) {
      return keyExtractor.extractAll({
        title: ctx.pr.title,
        branch: ctx.pr.headRef,
        body: `${ctx.body}\n${ctx.pr.body ?? ''}`,
      });
    }
    return keyExtractor.extractAll({ body: ctx.body });
  }

  if (ctx.event === 'release') {
    return keyExtractor.extractAll({
      title: ctx.releaseName,
      body: ctx.tagName,
    });
  }

  if (ctx.event === 'merge_group') {
    return keyExtractor.extractAll({ commitMessage: ctx.commitMessage, branch: ctx.headRef });
  }

  if (ctx.event === 'pull_request' || ctx.event === 'pull_request_review') {
    return keyExtractor.extractAll({
      title: ctx.pr.title,
      branch: ctx.pr.headRef,
      body: ctx.pr.body,
    });
  }

  return [];
}

async function syncOneIssue(
  compiled: CompiledSyncConfig,
  ctx: SyncEventContext,
  jira: NonNullable<ReturnType<typeof readJiraConfigFromEnv>>,
  issueKey: string
): Promise<void> {
  let jiraStatus: string | null;
  try {
    jiraStatus = await getIssueStatusName(jira, issueKey);
  } catch (err) {
    if (err instanceof JiraIssueNotFoundError) {
      log.info(`Issue ${issueKey} not found in Jira; skipping`);
      return;
    }
    throw err;
  }

  const rule = findMatchingRule(compiled.built, ctx, jiraStatus);
  if (!rule) {
    log.info(`No rule matched (${ctx.event}) for ${issueKey}`);
    return;
  }

  log.info(`Rule: ${rule.name} [${rule.id}] → ${issueKey}`);
  await executeAction(rule.then, {
    jira,
    compiled,
    issueKey,
    event: ctx,
    jiraStatus,
  });
}

/** Entry for one parsed webhook: may update zero or more Jira issues. */
export async function runSyncForContext(
  compiled: CompiledSyncConfig,
  eventCtx: SyncEventContext
): Promise<void> {
  const ctx = await withPullRequest(eventCtx);

  if (ctx.event === 'pull_request' || ctx.event === 'pull_request_review') {
    if (!isFromSameRepository(ctx.pr, ctx.repository)) {
      log.info('Skipping fork pull request');
      return;
    }
  }

  if (ctx.event === 'issue_comment' && ctx.pr && !isFromSameRepository(ctx.pr, ctx.repository)) {
    log.info('Skipping fork pull request comment');
    return;
  }

  if (ctx.event === 'workflow_run' && !shouldProcessWorkflowRun(ctx)) {
    return;
  }

  if ((ctx.event === 'check_suite' || ctx.event === 'check_run') && !shouldProcessCheck(ctx)) {
    return;
  }

  if (ctx.event === 'workflow_run' || ctx.event === 'check_suite' || ctx.event === 'check_run') {
    const gh = readGitHubAuthFromEnv();
    if (gh) {
      const prs = await findPullRequestsForCommit(gh, ctx.headSha);
      if (prs.some((pr) => !isFromSameRepository(pr, gh.repository))) {
        log.info(`Skipping ${ctx.event} linked to a fork pull request`);
        return;
      }
    }
  }

  const marker = compiled.options.skipMarker;
  if (marker) {
    const texts = await skipTextsForContext(ctx);
    if (texts.some((t) => textContainsSkipMarker(t, marker))) {
      log.info(`Skip marker "${marker}" present; skipping`);
      return;
    }
  }

  const issueKeys = await resolveIssueKeys(compiled, ctx);

  if (issueKeys.length === 0) {
    log.info(`No ${compiled.projectKey} issue key for event`);
    return;
  }

  let keysToProcess = issueKeys;
  if (!compiled.options.processAllMatchingIssueKeys && keysToProcess.length > 1) {
    keysToProcess = [keysToProcess[0]!];
  }

  const jira = readJiraConfigFromEnv();
  if (!jira) {
    log.annotate(
      'warning',
      `${keysToProcess.join(', ')} not updated: Jira credentials missing (${missingJiraCredentials().join(', ')}). ` +
        'Pass them as the jira-* inputs; secrets stored on a GitHub environment also need `environment:` on the job.'
    );
    return;
  }

  for (const issueKey of keysToProcess) {
    try {
      await syncOneIssue(compiled, ctx, jira, issueKey);
    } catch (err) {
      if (err instanceof JiraIssueNotFoundError) {
        log.info(`Issue ${issueKey} not found; skipping`);
        continue;
      }
      log.error(`Jira sync failed for ${issueKey}`, err);
      if (compiled.options.failOnJiraError) throw err;
    }
  }
}
