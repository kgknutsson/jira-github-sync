/**
 * GitHub Actions entrypoint for Jira ↔ GitHub sync.
 *
 * @module run
 */
import { validateJiraStringsAgainstProject } from './lib/adapters/jira/preflightConfig';
import { verifyJiraConnection, readJiraConfigFromEnv } from './lib/adapters/jira/client';
import { compileConfig } from './lib/config/compileConfig';
import { validateBuiltSyncConfig } from './lib/config/validateConfig';
import { readEventContext } from './lib/engine/eventContext';
import { runSyncForContext } from './lib/engine/runSync';
import { log } from './lib/utils/logger';
import { builtSyncConfig } from './settings';

const args = new Set(process.argv.slice(2));
const validateOnly = args.has('--validate-config');
const preflight = args.has('--preflight');

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

  const preflightIssues = await validateJiraStringsAgainstProject(jira, builtSyncConfig);
  for (const issue of preflightIssues) {
    const fn = issue.level === 'error' ? log.error : log.info;
    fn(`[jira preflight ${issue.level}] ${issue.message}`);
  }
  if (preflightIssues.some((issue) => issue.level === 'error')) process.exit(1);
  log.info('Jira status preflight OK');
  log.info(`Deploy map: ${JSON.stringify(builtSyncConfig.deploy.environmentToJiraStatus)}`);
}

async function main(): Promise<void> {
  if (validateOnly) {
    process.exit(printConfigValidation() ? 0 : 1);
  }

  if (preflight) {
    await runPreflight();
    return;
  }

  if (!process.env.GITHUB_EVENT_NAME || !process.env.GITHUB_EVENT_PATH) {
    log.info('Not running in GitHub Actions (missing event env); exit 0');
    log.info('Local checks: node dist/verify.mjs (from the jira-sync package folder)');
    log.info('Jira preflight: node dist/verify.mjs --preflight (needs JIRA_* env)');
    return;
  }

  const compiled = compileConfig(builtSyncConfig);
  const event = readEventContext();
  if ('skip' in event) {
    log.info(`${event.skip}; skipping`);
    return;
  }
  await runSyncForContext(compiled, event.ctx);
}

main().catch((err: unknown) => {
  log.error('fatal', err);
  process.exit(1);
});
