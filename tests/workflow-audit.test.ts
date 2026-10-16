import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { auditRules, auditWorkflow, type AuditFinding } from '../lib/audit/workflowAudit';
import { parseConfigText } from '../lib/config/configFile';
import type { BuiltSyncConfig } from '../lib/config/types';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const sample = parseConfigText(read('templates/jira-sync.config.yml')).config!;
const template = read('templates/jira-sync.workflow.yml');
const messages = (findings: AuditFinding[]) => findings.map((finding) => finding.message);

describe('auditWorkflow', () => {
  it('finds nothing for the template workflow with the sample rules', () => {
    expect(auditWorkflow(sample, template, { jobId: 'jira-sync' })).toEqual([]);
  });

  it('reports activity types the rules need', () => {
    const yml = template.replace(', closed]', ']');
    expect(messages(auditWorkflow(sample, yml))).toEqual([
      'on.pull_request.types is missing closed, which your rules need',
    ]);
  });

  it('reports missing triggers and workflow names', () => {
    const yml = template.replace('  release:\n    types: [published]\n', '').replace("'Quality Gate', ", '');
    expect(messages(auditWorkflow(sample, yml))).toEqual([
      'on.workflow_run.workflows is missing "Quality Gate", which your rules need',
      'Rules use release but the workflow does not trigger on it; add on.release',
    ]);
  });

  it("uses GitHub's default types when a trigger lists none", () => {
    const yml = [
      'on:',
      '  pull_request:',
      '  pull_request_review:',
      '  workflow_run: { workflows: [Quality Gate, Deploy] }',
      '  release:',
      'jobs: {}',
      '# workflow_run.head_repository guard elsewhere',
    ].join('\n');
    expect(messages(auditWorkflow(sample, yml))).toEqual(
      ['ready_for_review', 'edited', 'converted_to_draft', 'closed'].map(
        (type) => `on.pull_request.types is missing ${type}, which your rules need`
      )
    );
  });

  it('accepts on: as a single event or a list', () => {
    const releaseOnly: BuiltSyncConfig = { ...sample, rules: sample.rules.filter((r) => r.event === 'release') };
    expect(auditWorkflow(releaseOnly, 'on: release\n')).toEqual([]);
    expect(auditWorkflow(releaseOnly, 'on: [push, release]\n')).toEqual([]);
  });

  it('checks the permissions of the job that runs the action', () => {
    const noPrRead = template.replace('  pull-requests: read\n', '');
    expect(messages(auditWorkflow(sample, noPrRead))).toEqual([
      'Grant pull-requests: read so the action can find the PR (and issue key) for commits and comments',
    ]);
    const jobOverride = template.replace(
      '    timeout-minutes: 10\n',
      '    timeout-minutes: 10\n    permissions: read-all\n'
    );
    expect(auditWorkflow(sample, jobOverride.replace('  pull-requests: read\n', ''), { jobId: 'jira-sync' })).toEqual([]);
  });

  it('asks for a fork guard on workflow_run', () => {
    const yml = template.replace(/workflow_run\.head_repository/g, 'workflow_run.repository');
    expect(messages(auditWorkflow(sample, yml))).toEqual([
      expect.stringContaining('Skip workflow runs from forks'),
    ]);
  });
});

describe('auditRules', () => {
  it('passes the sample rules', () => {
    expect(auditRules(sample)).toEqual([]);
  });

  it('rejects deploy rules without a usable deploy map', () => {
    const noMap = { ...sample, deploy: { branchToEnvironment: {}, environmentToJiraStatus: {} } };
    expect(auditRules(noMap)).toEqual([
      { level: 'error', message: 'deployToJiraStatus rules need deploy.environmentToJiraStatus' },
      { level: 'error', message: 'deployToJiraStatus rules need deploy.jobNameRegex or deploy.branchToEnvironment' },
    ]);
    const noGroup = { ...sample, deploy: { ...sample.deploy, jobNameRegex: 'Deploy to (?:dev|prod)' } };
    expect(messages(auditRules(noGroup))).toEqual([
      expect.stringContaining('deploy.jobNameRegex needs a capture group'),
    ]);
  });

  it('warns about PR transitions that ignore closed PRs', () => {
    const [first] = sample.rules;
    const risky = { ...sample, rules: [{ ...first!, when: { action: 'edited' } }] };
    expect(messages(auditRules(risky))).toEqual([expect.stringContaining('without prState: open')]);
  });
});
