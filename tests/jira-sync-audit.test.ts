import { describe, expect, it } from 'vitest';

import {
  extractYamlStringList,
  runJiraSyncAudit,
  runJiraSyncPackageAudit,
} from '../lib/audit/syncAudit';
import { builtSyncConfig } from '../settings';

describe('jira-sync static audit', () => {
  it('example settings use project key PROJ', () => {
    expect(builtSyncConfig.projectKey).toBe('PROJ');
  });

  it('reports zero violations (config, workflow yaml, layout)', () => {
    const violations = runJiraSyncAudit();
    const summary = violations.map((v) => `${v.ruleId}: ${v.message}`).join('\n');
    expect(violations, summary || 'no violations').toEqual([]);
  });

  it('package audit passes (sample flow scenarios, docs coverage)', () => {
    const violations = runJiraSyncPackageAudit();
    const summary = violations.map((v) => `${v.ruleId}: ${v.message}`).join('\n');
    expect(violations, summary || 'no violations').toEqual([]);
  });
});

describe('extractYamlStringList', () => {
  it('reads inline and multi-line flow lists', () => {
    expect(extractYamlStringList("workflows: ['Quality Gate', \"Deploy\"]", 'workflows')).toEqual([
      'Quality Gate',
      'Deploy',
    ]);
    expect(extractYamlStringList('types:\n  [\n    opened, # new PR\n    closed,\n  ]', 'types')).toEqual([
      'opened',
      'closed',
    ]);
  });

  it('reads block sequences', () => {
    const block = [
      '    types:',
      '      - opened',
      "      - 'closed' # merged or not",
      '',
      '    branches: [main]',
    ].join('\r\n');
    expect(extractYamlStringList(block, 'types')).toEqual(['opened', 'closed']);
  });
});
