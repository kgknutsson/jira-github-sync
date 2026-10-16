/**
 * Dispatches a rule step to the appropriate action handler.
 *
 * @module actions/executeAction
 */
import type { RuleStep } from '../config/types';
import { runCommentAction } from './commentAction';
import { runDeployAction } from './deployAction';
import { runTransitionAction } from './transitionAction';
import type { ActionContext, ActionResult } from './types';

/** Runs comment, transition, or deploy step for one matched rule. */
export async function executeAction(step: RuleStep, ctx: ActionContext): Promise<ActionResult> {
  switch (step.kind) {
    case 'comment':
      await runCommentAction(step, ctx);
      return 'ok';
    case 'transition':
      return runTransitionAction(step, ctx);
    case 'deploy':
      return runDeployAction(step, ctx);
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}
