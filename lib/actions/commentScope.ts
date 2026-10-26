/**
 * Limits Jira comments when recent-commit scanning resolves many issue keys.
 *
 * @module actions/commentScope
 */
import type { ActionContext } from './types';

/** When head-only comment scope is active, noise comments (skipped / no transition) post only for those keys. */
export function commentAllowedForHeadScopedNoise(ctx: ActionContext): boolean {
  if (!ctx.commentHeadKeysOnly) return true;
  return ctx.commentHeadKeysOnly.has(ctx.issueKey);
}
