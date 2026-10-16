import { describe, expect, it } from 'vitest';

import { runJiraSyncAudit } from '../lib/audit/syncAudit';
import { builtSyncConfig } from '../settings';

describe('jira-sync static audit', () => {
  it('example settings use project key PROJ', () => {
    expect(builtSyncConfig.projectKey).toBe('PROJ');
  });

  it('reports zero violations (config, workflow yaml, docs, layout)', () => {
    const violations = runJiraSyncAudit();
    const summary = violations.map((v) => `${v.ruleId}: ${v.message}`).join('\n');
    expect(violations, summary || 'no violations').toEqual([]);
  });
});

