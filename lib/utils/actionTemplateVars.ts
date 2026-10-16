/**
 * Placeholders for comment templates and custom field values.
 *
 * @module utils/actionTemplateVars
 */
import type { SyncEventContext } from '../engine/types';

function commitUrl(repository: string, sha: string, suffix = ''): string {
  if (!repository || !sha) return '';
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  return `${server}/${repository}/commit/${sha}${suffix}`;
}

/**
 * Builds `{url}`, `{baseRef}`, `{headRef}`, etc. for {@link formatMessage}. Transition and deploy
 * steps layer `{status}` / `{targetStatus}` / `{env}` on top of these.
 */
export function actionTemplateVars(
  ctx: SyncEventContext,
  issueKey: string,
  jiraStatus: string | null
): Record<string, string> {
  const base: Record<string, string> = {
    issueKey,
    currentStatus: jiraStatus ?? '',
    status: jiraStatus ?? '',
    env: '',
    targetStatus: '',
  };

  switch (ctx.event) {
    case 'pull_request':
    case 'pull_request_review':
      return {
        ...base,
        url: ctx.url,
        prUrl: ctx.url,
        baseRef: ctx.pr.baseRef,
        headRef: ctx.pr.headRef,
        labels: ctx.pr.labels.join(', '),
        author: ctx.pr.authorLogin,
      };
    case 'workflow_run':
      return {
        ...base,
        url: ctx.runUrl,
        workflowName: ctx.workflowName,
        headRef: ctx.headBranch,
        runEvent: ctx.runEvent,
        conclusion: ctx.conclusion ?? '',
      };
    case 'check_suite':
    case 'check_run':
      return {
        ...base,
        url:
          ('checkUrl' in ctx ? ctx.checkUrl : '') ||
          commitUrl(ctx.repository, ctx.headSha, '/checks'),
        checkName: ctx.checkName,
        headRef: ctx.headBranch,
        conclusion: ctx.conclusion ?? '',
      };
    case 'issue_comment':
      return {
        ...base,
        url: ctx.url,
        prUrl: ctx.pr?.htmlUrl ?? ctx.url,
        baseRef: ctx.pr?.baseRef ?? '',
        headRef: ctx.pr?.headRef ?? '',
      };
    case 'push':
      return {
        ...base,
        url: commitUrl(ctx.repository, ctx.headSha),
        headRef: ctx.ref.replace(/^refs\/heads\//, ''),
        ref: ctx.ref,
      };
    case 'release':
      return {
        ...base,
        url: ctx.releaseUrl,
        releaseTag: ctx.tagName,
        releaseName: ctx.releaseName,
      };
    case 'merge_group':
      return {
        ...base,
        url: commitUrl(ctx.repository, ctx.headSha),
        headRef: ctx.headRef,
        baseRef: ctx.baseRef,
      };
    case 'deployment_status':
      return {
        ...base,
        url: ctx.deploymentUrl,
        env: ctx.environment,
        deploymentState: ctx.state,
        headRef: ctx.ref,
      };
    default:
      return base;
  }
}
