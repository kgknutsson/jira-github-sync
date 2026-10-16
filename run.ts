/**
 * GitHub Actions entrypoint for Jira ↔ GitHub sync.
 *
 * @module run
 */
import { readFileSync } from 'node:fs';

import { parseGitHubEvent } from './lib/adapters/github/parseEvent';
import { validateJiraStringsAgainstProject } from './lib/adapters/jira/preflightConfig';
import { verifyJiraConnection, readJiraConfigFromEnv } from './lib/adapters/jira/client';
import { compileConfig } from './lib/config/compileConfig';
import { validateBuiltSyncConfig } from './lib/config/validateConfig';
import { runSyncForContext } from './lib/engine/runSync';
import type { SyncEventContext } from './lib/engine/types';
import { log } from './lib/utils/logger';
import { builtSyncConfig } from './settings';

const args = new Set(process.argv.slice(2));
const validateOnly = args.has('--validate-config');
const preflight = args.has('--preflight');

const compiled = compileConfig(builtSyncConfig);

function printConfigValidation(): boolean {
  const issues = validateBuiltSyncConfig(builtSyncConfig);
  for (const issue of issues) {
    const fn = issue.level === 'error' ? log.error : log.info;
    fn(`[config ${issue.level}] ${issue.message}`);
  }
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length === 0) {
    log.info(
      `Config OK: ${builtSyncConfig.rules.length} rules, project ${builtSyncConfig.projectKey}`
    );
  }
  return errors.length === 0;
}

async function runPreflight(): Promise<void> {
  if (!printConfigValidation()) {
    process.exit(1);
  }
  const jira = readJiraConfigFromEnv();
  if (!jira) {
    log.error('Preflight failed: set JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN');
    process.exit(1);
  }
  const { accountId } = await verifyJiraConnection(jira);
  log.info(`Jira auth OK (accountId ${accountId})`);

  for (const issue of await validateJiraStringsAgainstProject(jira, builtSyncConfig)) {
    const fn = issue.level === 'error' ? log.error : log.info;
    fn(`[jira preflight ${issue.level}] ${issue.message}`);
    if (issue.level === 'error') process.exit(1);
  }
  log.info('Jira status preflight OK');
  log.info(`Deploy map: ${JSON.stringify(compiled.deployEnvToStatus)}`);
}

function contextFromParsed(
  parsed: NonNullable<ReturnType<typeof parseGitHubEvent>>,
  repository: string
): SyncEventContext | null {
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
        pr: parsed.pr,
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
    default:
      return null;
  }
}

async function main(): Promise<void> {
  if (validateOnly) {
    process.exit(printConfigValidation() ? 0 : 1);
  }

  if (preflight) {
    await runPreflight();
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;

  if (!eventName || !eventPath) {
    log.info('Not running in GitHub Actions (missing event env); exit 0');
    log.info('Local verify: pnpm verify:jira-sync');
    log.info('Jira preflight: node .github/workflows/jira-sync/dist/verify.mjs --preflight');
    return;
  }

  const payload = JSON.parse(readFileSync(eventPath, 'utf8')) as unknown;
  const parsed = parseGitHubEvent(eventName, payload);
  if (!parsed) {
    log.info(`Unsupported event: ${eventName}`);
    return;
  }

  if (!repository) return;
  const ctx = contextFromParsed(parsed, repository);
  if (!ctx) return;

  await runSyncForContext(compiled, ctx);
}

main().catch((err: unknown) => {
  log.error('fatal', err);
  process.exit(1);
});
