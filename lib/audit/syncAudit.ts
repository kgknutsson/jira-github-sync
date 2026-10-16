/**
 * Repository static audits: workflow YAML, docs, file layout, deploy alignment.
 *
 * Assumes `process.cwd()` is the repo root (Vitest / `verify.mjs` from root).
 *
 * @module audit/syncAudit
 */
import { jiraStatusNamesFromConfig } from '../config/jiraConfigLabels';
import {
  consumerFileExists,
  readConsumerFile,
  readPackageFile,
} from './repoPaths';
import { DEPLOY_FAIL_ENDS, RunTrigger } from '../config/syncCatalog';
import { builtSyncConfig } from '../../settings';
import { validateBuiltSyncConfig } from '../config/validateConfig';
import { compileConfig } from '../config/compileConfig';
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

function deployWorkflowNameFromConfig(): string {
  const rule = builtSyncConfig.rules.find(
    (r) => r.event === 'workflow_run' && r.then.kind === 'deploy'
  );
  const wf = rule?.when.workflow;
  return typeof wf === 'string' ? wf : '';
}

function qualityGateWorkflowNameFromConfig(): string {
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== 'workflow_run') continue;
    const runEvent = rule.when.runEvent;
    const isPrRun =
      runEvent === RunTrigger.PullRequest ||
      (Array.isArray(runEvent) && runEvent.includes(RunTrigger.PullRequest));
    if (!isPrRun) continue;
    const wf = rule.when.workflow;
    if (typeof wf === 'string') return wf;
  }
  return '';
}

const EXPECTED_WORKFLOW_NAMES = collectWorkflowNamesInRules();

/** Actions referenced by pull_request rules in settings.ts */
const SETTINGS_PR_ACTIONS = new Set<string>();

for (const rule of builtSyncConfig.rules) {
  if (rule.event !== 'pull_request') continue;
  const action = rule.when.action;
  if (typeof action === 'string') SETTINGS_PR_ACTIONS.add(action);
  if (Array.isArray(action)) action.forEach((a) => SETTINGS_PR_ACTIONS.add(a));
}

function extractYamlStringList(source: string, key: string): string[] {
  const inline = source.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`, 's'));
  const inner =
    inline?.[1] ?? source.match(new RegExp(`${key}:\\s*\\n\\s*\\[([^\\]]+)\\]`, 's'))?.[1];
  if (!inner) return [];

  const quoted = [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
  if (quoted.length > 0) return quoted;

  return [...inner.matchAll(/['"]?([a-z_]+)['"]?/gi)].map((m) => m[1]!).filter(Boolean);
}

/** Extract one `on:` trigger block (2-space indent under `on:`). */
function extractOnTriggerBlock(yml: string, trigger: string): string {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `^  ${escaped}:\\s*\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9_]*:|^concurrency:|^permissions:|^env:|^jobs:)`,
    'm'
  );
  return yml.match(re)?.[0] ?? '';
}

function extractPullRequestTypes(yml: string): string[] {
  const prBlock = extractOnTriggerBlock(yml, 'pull_request');
  if (!prBlock) return [];
  return extractYamlStringList(prBlock, 'types');
}

/** Validates compiled settings and flow scenario expectations. */
export function auditJiraSyncConfig(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];

  for (const issue of validateBuiltSyncConfig(builtSyncConfig)) {
    violations.push({
      ruleId: issue.level === 'error' ? 'config-validation' : 'config-warning',
      message: issue.message,
    });
  }

  const ruleIds = new Set<string>();
  for (const rule of builtSyncConfig.rules) {
    if (ruleIds.has(rule.id)) {
      violations.push({ ruleId: 'duplicate-rule-id', message: `Duplicate rule id: ${rule.id}` });
    }
    ruleIds.add(rule.id);
  }

  const compiled = compileConfig(builtSyncConfig, false);
  const sampleJob = 'Build and Deploy (test)';
  if (!compiled.deployJobPattern.test(sampleJob)) {
    violations.push({
      ruleId: 'deploy-job-regex',
      message: `deploy.jobNameRegex does not match sample job name "${sampleJob}"`,
    });
  }

  for (const env of Object.values(builtSyncConfig.deploy.branchToEnvironment)) {
    if (!(env in builtSyncConfig.deploy.environmentToJiraStatus)) {
      violations.push({
        ruleId: 'deploy-env-map',
        message: `branch maps to "${env}" but environmentToJiraStatus has no entry`,
      });
    }
  }

  const workflowNamesInRules = new Set<string>();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== 'workflow_run') continue;
    const wf = rule.when.workflow;
    if (typeof wf === 'string') workflowNamesInRules.add(wf);
    if (Array.isArray(wf)) wf.forEach((w) => workflowNamesInRules.add(w));
  }

  for (const name of workflowNamesInRules) {
    if (!EXPECTED_WORKFLOW_NAMES.includes(name)) {
      violations.push({
        ruleId: 'unknown-workflow-name',
        message: `Rule references workflow "${name}" not in expected list`,
      });
    }
  }

  for (const expected of EXPECTED_WORKFLOW_NAMES) {
    if (!workflowNamesInRules.has(expected)) {
      violations.push({
        ruleId: 'missing-workflow-rule',
        message: `No workflow_run rule targets workflow "${expected}"`,
      });
    }
  }

  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== 'workflow_run') continue;
    const wf = rule.when.workflow;
    const qg = qualityGateWorkflowNameFromConfig();
    const isQg = wf === qg || (Array.isArray(wf) && wf.includes(qg));
    if (!isQg) continue;
    const runEvent = rule.when.runEvent;
    const prRun = RunTrigger.PullRequest;
    const ok = runEvent === prRun || (Array.isArray(runEvent) && runEvent.includes(prRun));
    if (!ok) {
      violations.push({
        ruleId: 'qg-run-event',
        message: `Rule "${rule.name}" targets Quality Gate but missing runEvent pull_request (avoids nested deploy QG noise)`,
      });
    }
  }

  return violations;
}

/** Checks deploy/QG rule conditions align with the sample workflow conventions. */
export function auditJiraSyncFlowRules(): JiraSyncAuditViolation[] {
  const violations: JiraSyncAuditViolation[] = [];

  for (const failure of runJiraSyncFlowScenarioAudit()) {
    violations.push({ ruleId: 'flow-scenario', message: `[${failure.id}] ${failure.message}` });
  }

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
      rule.event === 'workflow_run' &&
      rule.when.workflow === deployWorkflowNameFromConfig() &&
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

/** Ensures `jira-sync.yml` triggers, permissions, and bundled runner command. */
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

  const runnerCmds = [
    'node .github/workflows/jira-sync/dist/run.mjs',
    'node dist/run.mjs',
  ];
  if (!runnerCmds.some((cmd) => yml.includes(cmd))) {
    violations.push({
      ruleId: 'workflow-entry',
      message: `jira-sync.yml must run bundled runner (${runnerCmds.join(' or ')}); no repo-root pnpm install`,
    });
  }
  if (
    yml.includes('pnpm install --frozen-lockfile') &&
    !yml.includes('working-directory: .github/workflows/jira-sync')
  ) {
    violations.push({
      ruleId: 'workflow-root-install',
      message: 'jira-sync.yml must not run repo-root pnpm install (use bundled dist/run.mjs)',
    });
  }
  if (yml.includes('pnpm exec tsx .github/workflows/jira-sync/run.ts')) {
    violations.push({
      ruleId: 'workflow-entry-legacy',
      message: 'jira-sync.yml must not invoke run.ts via tsx; rebuild dist and use dist/run.mjs',
    });
  }

  const wrBlock = extractOnTriggerBlock(yml, 'workflow_run');
  const listened = wrBlock ? extractYamlStringList(wrBlock, 'workflows') : [];
  for (const name of EXPECTED_WORKFLOW_NAMES) {
    if (!listened.includes(name)) {
      violations.push({
        ruleId: 'workflow-listen',
        message: `jira-sync.yml workflow_run.workflows missing "${name}"`,
      });
    }
  }

  const prTypesFromBlock = extractPullRequestTypes(yml);

  for (const action of SETTINGS_PR_ACTIONS) {
    if (!prTypesFromBlock.includes(action)) {
      violations.push({
        ruleId: 'pr-trigger-gap',
        message: `jira-sync.yml pull_request.types missing "${action}" (required by settings.ts)`,
      });
    }
  }

  if (!yml.includes('pull-requests: read')) {
    violations.push({
      ruleId: 'workflow-permissions',
      message: 'jira-sync.yml needs pull-requests: read for commit→PR issue key lookup',
    });
  }

  if (!yml.includes('checks: read')) {
    violations.push({
      ruleId: 'workflow-permissions-checks',
      message: 'jira-sync.yml needs checks: read for check_suite / check_run sync',
    });
  }

  const settingsEvents = new Set(builtSyncConfig.rules.map((r) => r.event));
  if (settingsEvents.has('check_suite')) {
    const csBlock = extractOnTriggerBlock(yml, 'check_suite');
    if (!csBlock || !extractYamlStringList(csBlock, 'types').includes('completed')) {
      violations.push({
        ruleId: 'check-suite-trigger',
        message: 'jira-sync.yml check_suite.types must include completed (settings has check_suite rules)',
      });
    }
  }
  if (settingsEvents.has('release')) {
    const relBlock = extractOnTriggerBlock(yml, 'release');
    if (!relBlock || !extractYamlStringList(relBlock, 'types').includes('published')) {
      violations.push({
        ruleId: 'release-trigger',
        message: 'jira-sync.yml release.types must include published (settings has release rules)',
      });
    }
  }

  if (!yml.includes('JIRA_BASE_URL') || !yml.includes('JIRA_API_TOKEN')) {
    violations.push({
      ruleId: 'workflow-secrets',
      message: 'jira-sync.yml must pass JIRA_* secrets to the sync step',
    });
  }

  if (!yml.includes('workflow_run.repository.id == github.repository_id')) {
    violations.push({
      ruleId: 'workflow-cross-repo',
      message: 'jira-sync job should guard workflow_run to same repository',
    });
  }

  const reviewBlock = extractOnTriggerBlock(yml, 'pull_request_review');
  const reviewTypes = reviewBlock ? extractYamlStringList(reviewBlock, 'types') : [];
  if (!reviewTypes.includes('submitted')) {
    violations.push({
      ruleId: 'pr-review-trigger',
      message: 'jira-sync.yml pull_request_review.types must include submitted',
    });
  }

  if (wrBlock && !extractYamlStringList(wrBlock, 'types').includes('completed')) {
    violations.push({
      ruleId: 'workflow-run-types',
      message: 'jira-sync.yml workflow_run.types must include completed',
    });
  }

  return violations;
}

/** Ensures package docs cover required setup phrases. */
export function auditJiraSyncDocs(): JiraSyncAuditViolation[] {
  return auditPackageDocs([]);
}

function auditPackageDocs(violations: JiraSyncAuditViolation[]): JiraSyncAuditViolation[] {
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

  const requiredInSetup = ['JIRA_BASE_URL', 'JIRA_API_TOKEN', '--preflight', 'settings.ts'];
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

/** Verifies required engine files and `dist/` bundle exist; no legacy script paths. */
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

/** Runs all Jira sync static audits; empty array means pass. */
export function runJiraSyncAudit(): JiraSyncAuditViolation[] {
  return [
    ...auditJiraSyncLayout(),
    ...auditJiraSyncConfig(),
    ...auditJiraSyncFlowRules(),
    ...auditJiraSyncWorkflowYaml(),
    ...auditJiraSyncDocs(),
  ];
}
