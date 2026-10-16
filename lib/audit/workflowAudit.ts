/**
 * Checks beyond config validation, run by the action before every sync:
 * - {@link auditRules}: deploy maps that cannot work (errors) and risky rule patterns (warnings)
 * - {@link auditWorkflow}: whether the calling workflow triggers on the events, activity types
 *   and workflow names the rules need, guards fork runs, and grants the API permissions used.
 *
 * @module audit/workflowAudit
 */
import { parse as parseYaml } from 'yaml';

import { DEPLOY_FAIL_CONCLUSIONS } from '../config/catalog';
import type { BuiltSyncConfig, GitHubEventKind } from '../config/types';

/** One audit result; errors stop the action, warnings are annotations only. */
export type AuditFinding = { level: 'error' | 'warning'; message: string };

/** Activity types GitHub uses when a trigger lists no `types` (other triggers: all types). */
const DEFAULT_TYPES: Partial<Record<GitHubEventKind, readonly string[]>> = {
  pull_request: ['opened', 'synchronize', 'reopened'],
  merge_group: ['checks_requested'],
};

/** Events whose sync looks up PRs or commits through the GitHub API. */
const PR_LOOKUP_EVENTS: readonly GitHubEventKind[] = [
  'workflow_run',
  'check_suite',
  'check_run',
  'deployment_status',
  'issue_comment',
];

function asList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Capture-group count of a regex source (the appended `|` makes it match the empty string). */
function captureGroupCount(source: string): number {
  return new RegExp(`${source}|`).exec('')!.length - 1;
}

/** Deploy maps that cannot work (errors) and rule patterns that are legal but risky (warnings). */
export function auditRules(built: BuiltSyncConfig): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const { deploy } = built;
  const deployRules = built.rules.filter((rule) => rule.then.kind === 'deploy');

  if (deployRules.length > 0) {
    if (Object.keys(deploy.environmentToJiraStatus).length === 0) {
      findings.push({
        level: 'error',
        message: 'deployToJiraStatus rules need deploy.environmentToJiraStatus',
      });
    }
    if (deploy.jobNameRegex !== undefined) {
      let groups = 1;
      try {
        groups = captureGroupCount(deploy.jobNameRegex);
      } catch {
        /* an invalid regex is already a config error */
      }
      if (groups < 1) {
        findings.push({
          level: 'error',
          message: 'deploy.jobNameRegex needs a capture group for the environment, e.g. \\((dev|prod)\\)',
        });
      }
    } else if (Object.keys(deploy.branchToEnvironment).length === 0) {
      findings.push({
        level: 'error',
        message: 'deployToJiraStatus rules need deploy.jobNameRegex or deploy.branchToEnvironment',
      });
    }
  }

  const deployWorkflows = new Set(deployRules.flatMap((rule) => asList(rule.when.workflow)));
  for (const rule of built.rules) {
    const prStates = asList(rule.when.prState);
    if (
      rule.event === 'pull_request' &&
      rule.then.kind === 'transition' &&
      !prStates.includes('open') &&
      rule.when.merged !== true
    ) {
      findings.push({
        level: 'warning',
        message: `Rule "${rule.name}" transitions on pull_request without prState: open, so edits to closed PRs would move the issue`,
      });
    }
    if (rule.event === 'pull_request_review' && !prStates.includes('open')) {
      findings.push({
        level: 'warning',
        message: `Rule "${rule.name}" has no prState: open, so reviews on closed PRs also trigger it`,
      });
    }
    if (
      rule.event === 'workflow_run' &&
      rule.then.kind === 'comment' &&
      rule.name.toLowerCase().includes('fail') &&
      asList(rule.when.workflow).some((name) => deployWorkflows.has(name))
    ) {
      const conclusions = asList(rule.when.conclusion);
      const missing = DEPLOY_FAIL_CONCLUSIONS.filter((c) => !conclusions.includes(c));
      if (missing.length > 0) {
        findings.push({
          level: 'warning',
          message: `Deploy failure rule "${rule.name}" does not cover conclusion ${missing.join(', ')}`,
        });
      }
    }
  }
  return findings;
}

/** `on:` as a map of trigger → settings (`on: push` and `on: [push, pull_request]` included). */
function triggersOf(on: unknown): Record<string, Record<string, unknown>> | null {
  if (typeof on === 'string') return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [String(event), {}]));
  if (!isRecord(on)) return null;
  return Object.fromEntries(
    Object.entries(on).map(([event, settings]) => [event, isRecord(settings) ? settings : {}])
  );
}

/** Whether `permissions` grants read or write on `scope`; `undefined` when not declared. */
function grants(permissions: unknown, scope: string): boolean | undefined {
  if (permissions === undefined) return undefined;
  if (permissions === 'read-all' || permissions === 'write-all') return true;
  if (!isRecord(permissions)) return false;
  return permissions[scope] === 'read' || permissions[scope] === 'write';
}

/** Permissions of the job that runs the action: `jobId`, else the job using this action. */
function effectivePermissions(workflow: Record<string, unknown>, jobId?: string): unknown {
  const jobs = isRecord(workflow.jobs) ? workflow.jobs : {};
  const job =
    (jobId && isRecord(jobs[jobId]) ? jobs[jobId] : undefined) ??
    Object.values(jobs).find(
      (candidate) =>
        isRecord(candidate) &&
        Array.isArray(candidate.steps) &&
        candidate.steps.some(
          (step) => isRecord(step) && /jira-github-sync|^\.\/?$/.test(String(step.uses ?? ''))
        )
    );
  return isRecord(job) && job.permissions !== undefined ? job.permissions : workflow.permissions;
}

/** Workflow-file checks for the events, types, workflow names and permissions the rules need. */
export function auditWorkflow(
  built: BuiltSyncConfig,
  workflowText: string,
  options: { jobId?: string } = {}
): AuditFinding[] {
  let workflow: unknown;
  try {
    workflow = parseYaml(workflowText);
  } catch (err) {
    return [{ level: 'warning', message: `Could not parse the workflow file: ${(err as Error).message}` }];
  }
  const triggers = isRecord(workflow) ? triggersOf(workflow.on) : null;
  if (!isRecord(workflow) || !triggers) {
    return [{ level: 'warning', message: 'The workflow file has no on: triggers' }];
  }

  const findings: AuditFinding[] = [];
  const events = [...new Set(built.rules.map((rule) => rule.event))];
  for (const event of events) {
    const settings = triggers[event];
    if (!settings) {
      findings.push({
        level: 'warning',
        message: `Rules use ${event} but the workflow does not trigger on it; add on.${event}`,
      });
      continue;
    }
    const rules = built.rules.filter((rule) => rule.event === event);
    const listed = asList(settings.types);
    const types = listed.length > 0 ? listed : DEFAULT_TYPES[event];
    const needed = new Set(rules.flatMap((rule) => asList(rule.when.action)));
    if (event === 'workflow_run' || event === 'check_suite' || event === 'check_run') {
      needed.add('completed');
    }
    if (types) {
      for (const type of needed) {
        if (!types.includes(type)) {
          findings.push({
            level: 'warning',
            message: `on.${event}.types is missing ${type}, which your rules need`,
          });
        }
      }
    }
    if (event === 'workflow_run') {
      const workflows = asList(settings.workflows);
      for (const name of new Set(rules.flatMap((rule) => asList(rule.when.workflow)))) {
        if (!workflows.includes(name)) {
          findings.push({
            level: 'warning',
            message: `on.workflow_run.workflows is missing "${name}", which your rules need`,
          });
        }
      }
    }
  }

  if (events.includes('workflow_run') && !workflowText.includes('workflow_run.head_repository')) {
    findings.push({
      level: 'warning',
      message:
        'Skip workflow runs from forks: add `if: github.event.workflow_run.head_repository.id == github.repository_id` to the job',
    });
  }

  const permissions = effectivePermissions(workflow, options.jobId);
  if (events.some((event) => PR_LOOKUP_EVENTS.includes(event)) && grants(permissions, 'pull-requests') === false) {
    findings.push({
      level: 'warning',
      message: 'Grant pull-requests: read so the action can find the PR (and issue key) for commits and comments',
    });
  }
  if (built.rules.some((rule) => rule.then.kind === 'deploy') && grants(permissions, 'actions') === false) {
    findings.push({
      level: 'warning',
      message: 'Grant actions: read so deploy rules can read job names (otherwise only the branch map is used)',
    });
  }
  return findings;
}
