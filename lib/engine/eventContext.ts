/**
 * Builds the engine's event context from the Actions environment (`GITHUB_EVENT_NAME`,
 * `GITHUB_EVENT_PATH`, `GITHUB_REPOSITORY`).
 *
 * @module engine/eventContext
 */
import { readFileSync } from 'node:fs';

import { parseGitHubEvent, type ParsedGitHubEvent } from '../adapters/github/parseEvent';
import type { SyncEventContext } from './types';

/** Maps a parsed webhook to the engine context. */
export function contextFromParsed(parsed: ParsedGitHubEvent, repository: string): SyncEventContext {
  switch (parsed.kind) {
    case 'pull_request':
      return {
        event: 'pull_request',
        action: parsed.action,
        pr: parsed.pr,
        repository,
        url: parsed.pr.htmlUrl,
      };
    case 'pull_request_review':
      return {
        event: 'pull_request_review',
        action: parsed.action,
        reviewState: parsed.reviewState,
        pr: parsed.pr,
        repository,
        url: parsed.pr.htmlUrl,
      };
    case 'workflow_run':
      return {
        event: 'workflow_run',
        workflowName: parsed.workflowName,
        runEvent: parsed.runEvent,
        conclusion: parsed.conclusion,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        runUrl: parsed.runUrl,
        runId: parsed.runId,
      };
    case 'check_suite':
      return {
        event: 'check_suite',
        action: parsed.action,
        conclusion: parsed.conclusion,
        checkName: parsed.checkName,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        repository,
      };
    case 'check_run':
      return {
        event: 'check_run',
        action: parsed.action,
        conclusion: parsed.conclusion,
        checkName: parsed.checkName,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        checkUrl: parsed.checkUrl,
        repository,
      };
    case 'issue_comment':
      return {
        event: 'issue_comment',
        action: parsed.action,
        body: parsed.body,
        pullRequestNumber: parsed.pullRequestNumber,
        pr: null,
        repository,
        url: parsed.commentUrl,
      };
    case 'push':
      return {
        event: 'push',
        ref: parsed.ref,
        headSha: parsed.headSha,
        commitMessages: parsed.commitMessages,
        repository,
      };
    case 'release':
      return {
        event: 'release',
        action: parsed.action,
        tagName: parsed.tagName,
        releaseName: parsed.releaseName,
        releaseUrl: parsed.releaseUrl,
        repository,
      };
    case 'merge_group':
      return {
        event: 'merge_group',
        action: parsed.action,
        headRef: parsed.headRef,
        headSha: parsed.headSha,
        baseRef: parsed.baseRef,
        commitMessage: parsed.commitMessage,
        repository,
      };
    case 'deployment_status':
      return {
        event: 'deployment_status',
        action: parsed.action,
        environment: parsed.environment,
        state: parsed.state,
        deploymentUrl: parsed.deploymentUrl,
        headSha: parsed.headSha,
        ref: parsed.ref,
        repository,
      };
  }
}

/** Context for the current Actions event, or why there is nothing to sync. */
export function readEventContext(
  env: NodeJS.ProcessEnv = process.env
): { ctx: SyncEventContext } | { skip: string } {
  const { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository } = env;
  if (!eventName || !eventPath) {
    return { skip: 'Not running in GitHub Actions (GITHUB_EVENT_NAME / GITHUB_EVENT_PATH missing)' };
  }
  if (!repository) return { skip: 'GITHUB_REPOSITORY not set' };

  const parsed = parseGitHubEvent(eventName, JSON.parse(readFileSync(eventPath, 'utf8')) as unknown);
  if (!parsed) return { skip: `Unsupported or incomplete ${eventName} event` };
  return { ctx: contextFromParsed(parsed, repository) };
}
