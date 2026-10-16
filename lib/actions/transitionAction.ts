/**
 * Moves a Jira issue to a fixed workflow status with optional follow-up comments.
 *
 * @module actions/transitionAction
 */
import { addIssueComment, transitionIssueToStatus } from '../adapters/jira/client';
import { actionTemplateVars } from '../utils/actionTemplateVars';
import { formatMessage } from '../utils/formatMessage';
import { log } from '../utils/logger';
import type { TransitionStep } from '../config/types';
import { runJiraSideEffects } from './jiraSideEffects';
import type { ActionContext, ActionResult } from './types';

async function commentWithKey(
  ctx: ActionContext,
  messageKey: string,
  extra: Record<string, string>
): Promise<void> {
  const text = formatMessage(ctx.compiled.messageTemplate(messageKey), {
    ...actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus),
    ...extra,
  });
  await addIssueComment(ctx.jira, ctx.issueKey, text);
}

/** Applies a fixed Jira status transition with optional side-effect comments. */
export async function runTransitionAction(
  step: TransitionStep,
  ctx: ActionContext
): Promise<ActionResult> {
  const result = await transitionIssueToStatus(ctx.jira, ctx.issueKey, step.status, step.via ?? []);

  if (!result.ok && result.reason === 'no_transition') {
    const messageId = step.onNoTransition ?? ctx.compiled.options.noTransitionMessageId;
    if (messageId) {
      await commentWithKey(ctx, messageId, {
        currentStatus: result.from,
        targetStatus: result.target,
      });
    }
    log.info(`No transition to ${step.status} for ${ctx.issueKey}`);
    return 'no_transition';
  }

  if (result.ok && 'skipped' in result && result.skipped) {
    if (step.commentWhenSkipped) {
      await commentWithKey(ctx, step.commentWhenSkipped, {
        status: step.status,
        targetStatus: step.status,
      });
    }
    return 'skipped';
  }

  if (result.ok && !('skipped' in result)) {
    if (step.commentAfterSuccess) {
      await commentWithKey(ctx, step.commentAfterSuccess, {
        status: result.to,
        targetStatus: result.to,
      });
    }
    await runJiraSideEffects(step.extras, ctx);
    log.info(`${ctx.issueKey}: → ${step.status}`);
    return 'ok';
  }

  return 'skipped';
}
