/**
 * Resolves deploy environment from workflow jobs / branch and transitions Jira accordingly.
 *
 * @module actions/deployAction
 */
import { transitionIssueToStatus } from '../adapters/jira/client';
import { listWorkflowRunJobs, readGitHubAuthFromEnv } from '../adapters/github/api';
import { actionTemplateVars } from '../utils/actionTemplateVars';
import { parseDeployEnvironment } from '../utils/deployEnvironment';
import { formatMessage } from '../utils/formatMessage';
import { log } from '../utils/logger';
import type { DeployTransitionStep } from '../config/types';
import { postIssueComment } from './postIssueComment';
import { runJiraSideEffects } from './jiraSideEffects';
import type { ActionContext, ActionResult } from './types';

async function commentWithKey(
  step: DeployTransitionStep,
  ctx: ActionContext,
  messageKey: string,
  extra: Record<string, string>
): Promise<void> {
  const text = formatMessage(ctx.compiled.messageTemplate(messageKey), {
    ...actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus),
    ...extra,
  });
  await postIssueComment(ctx, step, text, messageKey);
}

/** Maps deploy workflow conclusion to the correct Jira deploy column. */
export async function runDeployAction(
  step: DeployTransitionStep,
  ctx: ActionContext
): Promise<ActionResult> {
  if (ctx.event.event !== 'workflow_run') {
    log.info('Deploy action requires workflow_run context');
    return 'skipped';
  }

  const gh = readGitHubAuthFromEnv();
  let jobs: { name: string }[] = [];
  if (gh) {
    try {
      jobs = await listWorkflowRunJobs(gh, ctx.event.runId);
    } catch (err) {
      log.info('Could not list workflow jobs; using branch fallback', err);
    }
  }
  const allowBranchFallback = ctx.event.runEvent === 'push';
  const deployEnv = parseDeployEnvironment(
    jobs,
    ctx.event.headBranch,
    ctx.compiled.deployJobPattern,
    ctx.compiled.branchToDeployEnv,
    ctx.compiled.deployEnvToStatus,
    { allowBranchFallback }
  );

  if (!deployEnv) {
    log.info('Could not resolve deploy environment');
    return 'skipped';
  }

  const target = ctx.compiled.deployEnvToStatus[deployEnv];
  if (!target) {
    log.info(`No Jira status mapped for deploy env ${deployEnv}`);
    return 'skipped';
  }

  const result = await transitionIssueToStatus(ctx.jira, ctx.issueKey, target, []);
  const vars = {
    env: deployEnv,
    status: target,
    targetStatus: target,
    currentStatus: ctx.jiraStatus ?? '',
  };

  if (!result.ok && result.reason === 'no_transition') {
    const messageId = step.onNoTransition ?? ctx.compiled.options.noTransitionMessageId;
    if (messageId) {
      await commentWithKey(step, ctx, messageId, {
        ...vars,
        currentStatus: result.from,
        targetStatus: result.target,
      });
    }
    return 'no_transition';
  }

  if (result.ok && 'skipped' in result && result.skipped) {
    if (step.commentWhenSkipped) {
      await commentWithKey(step, ctx, step.commentWhenSkipped, vars);
    }
    log.info(`${ctx.issueKey}: deploy ${deployEnv} (already ${target})`);
    return 'skipped';
  }

  if (result.ok && !('skipped' in result)) {
    if (step.commentAfterSuccess) {
      await commentWithKey(step, ctx, step.commentAfterSuccess, vars);
    }
    await runJiraSideEffects(step.extras, ctx);
    log.info(`${ctx.issueKey}: deploy ${deployEnv} → ${target}`);
    return 'ok';
  }

  return 'skipped';
}
