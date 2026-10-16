/**
 * Repository static audits: `settings.ts` safety checks, workflow YAML drift, package layout.
 *
 * {@link runJiraSyncAudit} (run by `dist/verify.mjs`) only compares `settings.ts` with the host
 * repo's `jira-sync.yml`, so it keeps passing after you customize the sample rules.
 * {@link runJiraSyncPackageAudit} checks this repository's bundled sample (flow scenarios, docs)
 * and runs in the package's own tests.
 *
 * @module audit/syncAudit
 */
import { jiraStatusNamesFromConfig } from '../config/jiraConfigLabels';
import {
  consumerFileExists,
  packagePathFromConsumer,
  readConsumerFile,
  readPackageFile,
} from './repoPaths';
import { DEPLOY_FAIL_ENDS } from '../config/syncCatalog';
import type { GitHubEventKind } from '../config/types';
import { builtSyncConfig } from '../../settings';
import { validateBuiltSyncConfig } from '../config/validateConfig';
import { runJiraSyncFlowScenarioAudit } from './flowScenarios';

/** One failed static check (workflow drift, missing doc phrase, etc.). */
export type JiraSyncAuditViolation = {
  ruleId: string;
  message: string;
};

function collectWorkflowNamesInRules(): string[] {
  const names = new Set<string>();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== 'workflow_run') continue;
    const wf = rule.when.workflow;
    if (typeof wf === 'string') names.add(wf);
    if (Array.isArray(wf)) wf.forEach((w) => names.add(w));
  }
  return [...names];
}

/** Every `action` value used by rules for one event (empty when no rule filters on action). */
function collectActionsInRules(event: GitHubEventKind): string[] {
  const actions = new Set<string>();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== event) continue;
    const action = rule.when.action;
    if (typeof action === 'string') actions.add(action);
    if (Array.isArray(action)) action.forEach((a) => actions.add(a));
  }
  return [...actions];
}

function deployWorkflowNameFromConfig(): string {
  const rule = builtSyncConfig.rules.find(
    (r) => r.event === 'workflow_run' && r.then.kind === 'deploy'
  );
  const wf = rule?.when.workflow;
  return typeof wf === 'string' ? wf : '';
}

/** Capture-group count of a regex source (the appended `|` makes it match the empty string). */
function captureGroupCount(source: string): number {
  return new RegExp(`${source}|`).exec('')!.length - 1;
}

function unquoteYamlItem(item: string): string {
  return item.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** Reads `key: [a, b]` (inline, possibly multi-line) or a `key:` block sequence of `- item` lines. */
export function extractYamlStringList(source: string, key: string): string[] {
  const inline = source.match(new RegExp(`(?<![\\w-])${key}:\\s*\\[([^\\]]*)\\]`, 's'))?.[1];
  if (inline !== undefined) {
    const withoutComments = inline.replace(/(^|\s)#.*$/gm, '$1');
    return [...withoutComments.matchAll(/'([^']*)'|"([^"]*)"|([^,'"\s][^,]*)/g)]
      .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim())
      .filter(Boolean);
  }

  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*(#.*)?$`).test(line));
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = line.match(/^\s*-\s*(.+?)\s*(?:\s#.*)?$/);
    if (!item) break;
    items.push(unquoteYamlItem(item[1]!));
  }
  return items;
}

/** Activity types GitHub uses when a trigger has no `types:` list (other triggers: all types). */
const DEFAULT_TRIGGER_TYPES: Record<string, string[]> = {
  pull_request: ['opened', 'synchronize', 'reopened'],
};

/** Extract one `on:` trigger block (2-space indent under `on:`). */
function extractOnTriggerBlock(yml: string, trigger: string): string {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `^  ${escaped}:[^\\n]*\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9_]*:|^concurrency:|^permissions:|^env:|^jobs:)`,
    'm'
  );
  return yml.match(re)?.[0] ?? '';
}

/** Validates compiled settings: config errors/warnings and deploy maps. */
export function auditJiraSyncConfig(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];

  for (const issue of validateBuiltSyncConfig(builtSyncConfig)) {
    violations.push({
      ruleId: issue.level === 'error' ? 'config-validation' : 'config-warning',
      message: issue.message,
    });
  }

  const { deploy } = builtSyncConfig;
  if (builtSyncConfig.rules.some((r) => r.then.kind === 'deploy')) {
    if (Object.keys(deploy.environmentToJiraStatus).length === 0) {
      violations.push({
        ruleId: 'deploy-map-empty',
        message: 'deployToJiraStatus() is used but .deploy({ environmentToJiraStatus }) is empty',
      });
    }
    let groups = 1;
    try {
      if (deploy.jobNameRegex !== undefined) groups = captureGroupCount(deploy.jobNameRegex);
    } catch {
      /* invalid regex is already reported by validateBuiltSyncConfig */
    }
    if (groups < 1) {
      violations.push({
        ruleId: 'deploy-job-regex',
        message: 'deploy.jobNameRegex needs a capture group for the environment, e.g. \\((dev|prod)\\)',
      });
    }
  }

  for (const env of Object.values(deploy.branchToEnvironment)) {
    if (!Object.hasOwn(deploy.environmentToJiraStatus, env)) {
      violations.push({
        ruleId: 'deploy-env-map',
        message: `branch maps to "${env}" but environmentToJiraStatus has no entry`,
      });
    }
  }

  return violations;
}

/** Checks rule conditions against common safety conventions (open PRs, deploy failures). */
export function auditJiraSyncFlowRules(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];
  const deployWorkflow = deployWorkflowNameFromConfig();

  for (const rule of builtSyncConfig.rules) {
    if (rule.event === 'pull_request' && rule.then.kind === 'transition') {
      const prState = rule.when.prState;
      const requiresOpen =
        prState === 'open' || (Array.isArray(prState) && prState.includes('open'));
      if (!requiresOpen && rule.when.merged !== true) {
        violations.push({
          ruleId: 'flow-pr-transition-state',
          message: `Rule "${rule.name}" transitions on pull_request but does not require prState open`,
        });
      }
    }
    if (rule.event === 'pull_request_review') {
      const prState = rule.when.prState;
      const requiresOpen =
        prState === 'open' || (Array.isArray(prState) && prState.includes('open'));
      if (!requiresOpen) {
        violations.push({
          ruleId: 'flow-review-state',
          message: `Rule "${rule.name}" handles pull_request_review but does not require prState open`,
        });
      }
    }
    if (
      deployWorkflow &&
      rule.event === 'workflow_run' &&
      rule.when.workflow === deployWorkflow &&
      rule.then.kind === 'comment' &&
      rule.name.toLowerCase().includes('failed')
    ) {
      const conclusion = rule.when.conclusion;
      const arr = Array.isArray(conclusion) ? conclusion : conclusion ? [conclusion] : [];
      for (const required of DEPLOY_FAIL_ENDS) {
        if (!arr.includes(required)) {
          violations.push({
            ruleId: 'flow-deploy-failure-conclusions',
            message: `Deploy failure rule "${rule.name}" should include conclusion "${required}"`,
          });
        }
      }
    }
  }

  return violations;
}

/** Ensures `jira-sync.yml` triggers, permissions, secrets, and bundled runner command. */
export function auditJiraSyncWorkflowYaml(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];
  if (!consumerFileExists('.github/workflows/jira-sync.yml')) {
    violations.push({
      ruleId: 'workflow-missing',
      message:
        'Missing .github/workflows/jira-sync.yml in consumer repo (copy from templates/jira-sync.workflow.yml)',
    });
    return violations;
  }
  const yml = readConsumerFile('.github/workflows/jira-sync.yml');
  const settingsEvents = new Set(builtSyncConfig.rules.map((r) => r.event));

  const packagePath = packagePathFromConsumer();
  const bundledRunner = `node ${packagePath ? `${packagePath}/` : ''}dist/run.mjs`;
  const runnerCmds = [...new Set([bundledRunner, 'node dist/run.mjs'])];
  if (!runnerCmds.some((cmd) => yml.includes(cmd))) {
    violations.push({
      ruleId: 'workflow-entry',
      message: `jira-sync.yml must run the bundled runner (${runnerCmds.join(' or ')})`,
    });
  }

  const requireTypes = (trigger: string, required: string[], ruleId: string): void => {
    if (required.length === 0) return;
    const block = extractOnTriggerBlock(yml, trigger);
    let types = block ? extractYamlStringList(block, 'types') : [];
    if (block && types.length === 0) {
      const defaults = DEFAULT_TRIGGER_TYPES[trigger];
      if (!defaults) return;
      types = defaults;
    }
    for (const type of required) {
      if (!types.includes(type)) {
        violations.push({
          ruleId,
          message: `jira-sync.yml ${trigger}.types missing "${type}" (required by settings.ts)`,
        });
      }
    }
  };

  requireTypes('pull_request', collectActionsInRules('pull_request'), 'pr-trigger-gap');
  requireTypes(
    'pull_request_review',
    collectActionsInRules('pull_request_review'),
    'pr-review-trigger'
  );
  requireTypes('release', collectActionsInRules('release'), 'release-trigger');
  if (settingsEvents.has('check_suite')) {
    requireTypes('check_suite', ['completed'], 'check-suite-trigger');
  }
  if (settingsEvents.has('check_run')) {
    requireTypes('check_run', ['completed'], 'check-run-trigger');
  }

  const wrBlock = extractOnTriggerBlock(yml, 'workflow_run');
  const listened = wrBlock ? extractYamlStringList(wrBlock, 'workflows') : [];
  for (const name of collectWorkflowNamesInRules()) {
    if (!listened.includes(name)) {
      violations.push({
        ruleId: 'workflow-listen',
        message: `jira-sync.yml workflow_run.workflows missing "${name}"`,
      });
    }
  }
  if (wrBlock && !extractYamlStringList(wrBlock, 'types').includes('completed')) {
    violations.push({
      ruleId: 'workflow-run-types',
      message: 'jira-sync.yml workflow_run.types must include completed',
    });
  }
  if (
    settingsEvents.has('workflow_run') &&
    !yml.includes('workflow_run.repository.id == github.repository_id')
  ) {
    violations.push({
      ruleId: 'workflow-cross-repo',
      message: 'jira-sync job should guard workflow_run to same repository',
    });
  }

  if (!yml.includes('pull-requests: read')) {
    violations.push({
      ruleId: 'workflow-permissions',
      message: 'jira-sync.yml needs pull-requests: read for commit→PR issue key lookup',
    });
  }
  if (
    (settingsEvents.has('check_suite') || settingsEvents.has('check_run')) &&
    !yml.includes('checks: read')
  ) {
    violations.push({
      ruleId: 'workflow-permissions-checks',
      message: 'jira-sync.yml needs checks: read for check_suite / check_run sync',
    });
  }

  for (const secret of ['JIRA_BASE_URL', 'JIRA_USER_EMAIL', 'JIRA_API_TOKEN']) {
    if (!yml.includes(secret)) {
      violations.push({
        ruleId: 'workflow-secrets',
        message: `jira-sync.yml must pass ${secret} to the sync step`,
      });
    }
  }
  if (!/GITHUB_TOKEN:\s*\$\{\{\s*(secrets\.GITHUB_TOKEN|github\.token)\s*\}\}/.test(yml)) {
    violations.push({
      ruleId: 'workflow-github-token',
      message:
        'jira-sync.yml must pass GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} (PR / commit issue-key lookup)',
    });
  }

  return violations;
}

/** Verifies required engine files and `dist/` bundle exist. */
export function auditJiraSyncLayout(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];
  const required = [
    'package.json',
    'build.mjs',
    'dist/run.mjs',
    'dist/verify.mjs',
    'run.ts',
    'verify.ts',
    'lib/config/syncCatalog.ts',
    'settings.ts',
    'lib/audit/syncAudit.ts',
    'lib/engine/runSync.ts',
    'lib/adapters/jira/client.ts',
    'authoring-guide.md',
    'setup.md',
  ];
  for (const rel of required) {
    try {
      readPackageFile(rel);
    } catch {
      violations.push({ ruleId: 'layout-missing', message: `Missing required file ${rel}` });
    }
  }
  return violations;
}

/** Ensures this package's docs cover required setup phrases and the sample's Jira statuses. */
export function auditJiraSyncPackageDocs(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];
  const guide = readPackageFile('authoring-guide.md');
  const setup = readPackageFile('setup.md');

  const requiredInGuide = [
    'settings.ts',
    'syncCatalog.ts',
    'When',
    'If',
    'noTransitionMessageId',
    '[skip-jira]',
    'jira-sync.yml',
  ];
  for (const snippet of requiredInGuide) {
    if (!guide.includes(snippet)) {
      violations.push({
        ruleId: 'doc-coverage',
        message: `authoring-guide.md missing "${snippet}"`,
      });
    }
  }

  const requiredInSetup = [
    'JIRA_BASE_URL',
    'JIRA_USER_EMAIL',
    'JIRA_API_TOKEN',
    '--preflight',
    'settings.ts',
  ];
  for (const snippet of requiredInSetup) {
    if (!setup.includes(snippet)) {
      violations.push({
        ruleId: 'doc-coverage',
        message: `setup.md missing "${snippet}"`,
      });
    }
  }

  for (const status of jiraStatusNamesFromConfig(builtSyncConfig)) {
    if (!guide.toLowerCase().includes(status.toLowerCase()) && !setup.includes(status)) {
      violations.push({
        ruleId: 'doc-event-matrix',
        message: `authoring-guide.md or setup.md should mention Jira status "${status}" from settings.ts`,
      });
    }
  }

  return violations;
}

/** Runs all portable static audits used by `dist/verify.mjs`; empty array means pass. */
export function runJiraSyncAudit(): JiraSyncAuditViolation[] {
  return [
    ...auditJiraSyncLayout(),
    ...auditJiraSyncConfig(),
    ...auditJiraSyncFlowRules(),
    ...auditJiraSyncWorkflowYaml(),
  ];
}

/** Checks tied to this repository's sample `settings.ts` and docs (package tests only). */
export function runJiraSyncPackageAudit(): JiraSyncAuditViolation[] {
  return [
    ...runJiraSyncFlowScenarioAudit().map((failure) => ({
      ruleId: 'flow-scenario',
      message: `[${failure.id}] ${failure.message}`,
    })),
    ...auditJiraSyncPackageDocs(),
  ];
}
