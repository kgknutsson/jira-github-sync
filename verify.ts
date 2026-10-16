/**
 * Local verification entrypoint (config validation + static repo audits).
 *
 * Invoked by `pnpm verify:jira-sync` via `dist/verify.mjs`. Does not call Jira
 * unless `--preflight` is set (requires `JIRA_*` secrets in env).
 *
 * @module verify
 */
import { runJiraSyncAudit } from './lib/audit/syncAudit';
import { validateBuiltSyncConfig } from './lib/config/validateConfig';
import { validateJiraStringsAgainstProject } from './lib/adapters/jira/preflightConfig';
import { readJiraConfigFromEnv, verifyJiraConnection } from './lib/adapters/jira/client';
import { builtSyncConfig } from './settings';
import { log } from './lib/utils/logger';

const args = new Set(process.argv.slice(2));

async function main(): Promise<void> {
  const configErrors = validateBuiltSyncConfig(builtSyncConfig).filter((i) => i.level === 'error');
  if (configErrors.length > 0) {
    for (const issue of configErrors) {
      log.error(`[config] ${issue.message}`);
    }
    process.exit(1);
  }

  const violations = runJiraSyncAudit();
  for (const v of violations) {
    const fn = v.ruleId === 'config-warning' ? log.info : log.error;
    fn(`[${v.ruleId}] ${v.message}`);
  }
  if (violations.some((v) => v.ruleId !== 'config-warning')) {
    process.exit(1);
  }

  log.info(
    `Jira sync verify OK: ${builtSyncConfig.rules.length} rules, project ${builtSyncConfig.projectKey}`
  );

  if (args.has('--preflight')) {
    const jira = readJiraConfigFromEnv();
    if (!jira) {
      log.error('Preflight failed: set JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN');
      process.exit(1);
    }
    const { accountId } = await verifyJiraConnection(jira);
    log.info(`Jira preflight OK (accountId ${accountId})`);
    for (const issue of await validateJiraStringsAgainstProject(jira, builtSyncConfig)) {
      const fn = issue.level === 'error' ? log.error : log.info;
      fn(`[jira preflight ${issue.level}] ${issue.message}`);
      if (issue.level === 'error') process.exit(1);
    }
    log.info('Jira workflow status names OK');
  }
}

main().catch((err: unknown) => {
  log.error('fatal', err);
  process.exit(1);
});
