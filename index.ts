/**
 * GitHub Action entrypoint (runs with no arguments) and local CLI:
 *
 *   node dist/index.mjs validate [rules-file] [--workflow <file>] [--preflight]
 *
 * Both load the rules file, report problems as annotations with line numbers, and check the
 * workflow's triggers against the rules. The action then syncs the current event to Jira.
 *
 * @module index
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { readJiraConfigFromEnv, verifyJiraConnection } from './lib/adapters/jira/client';
import { validateJiraStringsAgainstProject } from './lib/adapters/jira/preflightConfig';
import { auditRules, auditWorkflow } from './lib/audit/workflowAudit';
import { compileConfig } from './lib/config/compileConfig';
import { loadConfigFile } from './lib/config/configFile';
import type { BuiltSyncConfig } from './lib/config/types';
import { readEventContext } from './lib/engine/eventContext';
import { runSyncForContext } from './lib/engine/runSync';
import { log } from './lib/utils/logger';

const DEFAULT_CONFIG = '.github/jira-sync.config.yml';
const DEFAULT_WORKFLOW = '.github/workflows/jira-sync.yml';
const USAGE = 'Usage: jira-github-sync validate [rules-file] [--workflow <file>] [--preflight]';

type FileRef = { path: string; display: string };

/** Action input (`with:`), from the `INPUT_*` variable the runner sets. */
function input(name: string): string {
  return (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

/** Copies credentials from action inputs into the env names the engine reads. */
function exportCredentials(): void {
  const names: Record<string, string> = {
    'jira-base-url': 'JIRA_BASE_URL',
    'jira-user-email': 'JIRA_USER_EMAIL',
    'jira-api-token': 'JIRA_API_TOKEN',
    'github-token': 'GITHUB_TOKEN',
  };
  for (const [inputName, envName] of Object.entries(names)) {
    const value = input(inputName);
    if (value) process.env[envName] = value;
  }
}

/** Loads the rules file and checks it (and the workflow, if given); `null` when anything fails. */
function loadAndCheck(rules: FileRef, workflow?: FileRef & { jobId?: string }): BuiltSyncConfig | null {
  if (!existsSync(rules.path)) {
    log.annotate(
      'error',
      `Rules file ${rules.display} not found. Add it (start from templates/jira-sync.config.yml) and check out the repository before this step.`
    );
    return null;
  }
  const { config, issues } = loadConfigFile(rules.path);
  for (const issue of issues) {
    log.annotate(issue.level, issue.message, { file: rules.display, line: issue.line, column: issue.column });
  }
  if (!config) return null;

  const findings = auditRules(config);
  for (const finding of findings) log.annotate(finding.level, finding.message, { file: rules.display });
  if (workflow && existsSync(workflow.path)) {
    const text = readFileSync(workflow.path, 'utf8');
    for (const finding of auditWorkflow(config, text, { jobId: workflow.jobId })) {
      log.annotate(finding.level, finding.message, { file: workflow.display });
    }
  }
  return findings.some((finding) => finding.level === 'error') ? null : config;
}

/** Checks Jira credentials and that every status in the rules exists in the project. */
async function checkJira(config: BuiltSyncConfig): Promise<boolean> {
  const jira = readJiraConfigFromEnv();
  if (!jira) {
    log.info('Jira credentials not set; skipping the Jira status check');
    return true;
  }
  const { accountId } = await verifyJiraConnection(jira);
  log.info(`Jira auth OK (accountId ${accountId})`);
  const issues = await validateJiraStringsAgainstProject(jira, config);
  for (const issue of issues) log.annotate(issue.level, issue.message);
  if (!issues.some((issue) => issue.level === 'error')) log.info('Jira status names OK');
  return !issues.some((issue) => issue.level === 'error');
}

/** Workflow file of the current run, from `GITHUB_WORKFLOW_REF` (`owner/repo/<path>@<ref>`). */
function currentWorkflowFile(): string | undefined {
  const ref = process.env.GITHUB_WORKFLOW_REF;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!ref || !repository || !ref.startsWith(`${repository}/`)) return undefined;
  return ref.slice(repository.length + 1).replace(/@.*$/, '');
}

async function runAction(): Promise<void> {
  exportCredentials();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const rulesFile = input('config-file') || DEFAULT_CONFIG;
  const workflowFile = currentWorkflowFile();
  const config = loadAndCheck(
    { path: resolve(workspace, rulesFile), display: rulesFile },
    workflowFile
      ? { path: resolve(workspace, workflowFile), display: workflowFile, jobId: process.env.GITHUB_JOB }
      : undefined
  );
  if (!config) {
    process.exitCode = 1;
    return;
  }
  log.info(`Loaded ${config.rules.length} rules for ${config.projectKey} from ${rulesFile}`);

  if (input('validate-only') === 'true') {
    if (!(await checkJira(config))) process.exitCode = 1;
    return;
  }

  const event = readEventContext();
  if ('skip' in event) {
    log.info(`${event.skip}; nothing to sync`);
    return;
  }
  await runSyncForContext(compileConfig(config), event.ctx);
}

async function runCli(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command !== 'validate') {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  let rulesFile = DEFAULT_CONFIG;
  let workflowFile: string | undefined;
  let preflight = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--preflight') preflight = true;
    else if (arg === '--workflow' && rest[i + 1]) workflowFile = rest[++i];
    else if (!arg.startsWith('--')) rulesFile = arg;
    else {
      console.log(USAGE);
      process.exitCode = 1;
      return;
    }
  }
  workflowFile ??= existsSync(DEFAULT_WORKFLOW) ? DEFAULT_WORKFLOW : undefined;

  const ref = (file: string): FileRef => ({ path: resolve(file), display: relative(process.cwd(), resolve(file)) });
  const config = loadAndCheck(ref(rulesFile), workflowFile ? ref(workflowFile) : undefined);
  if (!config) {
    process.exitCode = 1;
    return;
  }
  log.info(`${ref(rulesFile).display}: ${config.rules.length} rules for ${config.projectKey} OK`);
  if (preflight && !(await checkJira(config))) process.exitCode = 1;
}

const args = process.argv.slice(2);
const run = args.length > 0 ? runCli(args) : process.env.GITHUB_ACTIONS === 'true' ? runAction() : runCli([]);
run.catch((err: unknown) => {
  log.error('fatal', err);
  process.exitCode = 1;
});
