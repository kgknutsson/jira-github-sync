/**
 * Respects per-rule {@link RuleStep.commentOnIssue} before calling Jira.
 *
 * @module actions/postIssueComment
 */
import { addIssueComment } from '../adapters/jira/client';
import type { RuleStep } from '../config/types';
import { log } from '../utils/logger';
import { ruleAllowsComments } from './ruleComments';
import type { ActionContext } from './types';

/** Posts a comment when the rule allows it; returns whether a comment was sent. */
export async function postIssueComment(
  ctx: ActionContext,
  step: RuleStep,
  text: string,
  messageKey: string
): Promise<boolean> {
  if (!ruleAllowsComments(step)) {
    log.info(`commentOnIssue not enabled; skipping comment (${messageKey}) on ${ctx.issueKey}`);
    return false;
  }
  await addIssueComment(ctx.jira, ctx.issueKey, text);
  return true;
}
