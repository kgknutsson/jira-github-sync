/**
 * Remote links and custom fields after a rule step.
 *
 * @module actions/jiraSideEffects
 */
import {
  addIssueRemoteLink,
  updateIssueFields,
} from '../adapters/jira/client';
import type { JiraStepExtras } from '../config/jiraStepExtras';
import { formatMessage } from '../utils/formatMessage';
import { actionTemplateVars } from '../utils/actionTemplateVars';
import { log } from '../utils/logger';
import type { ActionContext } from './types';

function linkUrl(ctx: ActionContext, kind: NonNullable<JiraStepExtras['linkGithub']>): string {
  const ev = ctx.event;
  if (kind === 'pull_request') {
    if (ev.event === 'pull_request' || ev.event === 'pull_request_review') return ev.url;
    if (ev.event === 'issue_comment' && ev.pr) return ev.pr.htmlUrl;
  }
  if (kind === 'workflow_run' && ev.event === 'workflow_run') return ev.runUrl;
  if (kind === 'release' && ev.event === 'release') return ev.releaseUrl;
  return '';
}

function linkTitle(ctx: ActionContext, kind: NonNullable<JiraStepExtras['linkGithub']>): string {
  if (kind === 'pull_request') return 'GitHub pull request';
  if (kind === 'workflow_run') return 'GitHub Actions workflow run';
  if (kind === 'release' && ctx.event.event === 'release') return `Release ${ctx.event.tagName}`;
  return 'GitHub';
}

/** Applies optional {@link JiraStepExtras} after comment/transition/deploy. */
export async function runJiraSideEffects(
  extras: JiraStepExtras | undefined,
  ctx: ActionContext
): Promise<void> {
  if (!extras) return;

  if (extras.linkGithub) {
    const url = linkUrl(ctx, extras.linkGithub);
    if (url) {
      await addIssueRemoteLink(ctx.jira, ctx.issueKey, url, linkTitle(ctx, extras.linkGithub));
      log.info(`Remote link (${extras.linkGithub}) on ${ctx.issueKey}`);
    }
  }

  if (extras.fields && Object.keys(extras.fields).length > 0) {
    const vars = actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus);
    const resolved: Record<string, string> = {};
    for (const [fieldId, template] of Object.entries(extras.fields)) {
      resolved[fieldId] = formatMessage(template, vars);
    }
    await updateIssueFields(ctx.jira, ctx.issueKey, resolved);
    log.info(`Updated ${Object.keys(resolved).length} field(s) on ${ctx.issueKey}`);
  }
}
