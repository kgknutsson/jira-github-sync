/**
 * Per-rule Jira comment opt-in (`commentOnIssue` on each rule).
 *
 * @module actions/ruleComments
 */
import type { RuleStep } from '../config/types';

/**
 * Comment-only rules post by default (`comment:` is the action). Transition and deploy rules
 * post only when `commentOnIssue: true` (even if `commentAfterSuccess` / `onNoTransition` are set).
 */
export function ruleAllowsComments(step: RuleStep): boolean {
  if (step.kind === 'comment') return step.commentOnIssue !== false;
  return step.commentOnIssue === true;
}
