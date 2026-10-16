/**
 * Posts a templated Jira comment (no status change).
 *
 * @module actions/commentAction
 */
import { addIssueComment } from '../adapters/jira/client';
import { formatMessage } from '../utils/formatMessage';
import { actionTemplateVars } from '../utils/actionTemplateVars';
import { log } from '../utils/logger';
import type { CommentStep } from '../config/types';
import { runJiraSideEffects } from './jiraSideEffects';
import type { ActionContext } from './types';

/** Posts the rule's message template as a Jira comment. */
export async function runCommentAction(step: CommentStep, ctx: ActionContext): Promise<void> {
  const vars = actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus);
  const text = formatMessage(ctx.compiled.messageTemplate(step.messageKey), vars);
  await addIssueComment(ctx.jira, ctx.issueKey, text);
  await runJiraSideEffects(step.extras, ctx);
  log.info(`Comment (${step.messageKey}) on ${ctx.issueKey}`);
}
