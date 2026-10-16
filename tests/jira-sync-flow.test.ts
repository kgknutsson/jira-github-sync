import { describe, expect, it } from 'vitest';

import {
  JIRA_SYNC_FLOW_SCENARIOS,
  evaluateFlowScenario,
  runJiraSyncFlowScenarioAudit,
} from '../lib/audit/flowScenarios';
import { conditionsMatch } from '../lib/engine/matchRule';
import type { PullRequestContext } from '../lib/engine/types';

describe('jira-sync flow scenarios', () => {
  it('all documented scenarios match expected rules', () => {
    const failures = runJiraSyncFlowScenarioAudit();
    const summary = failures.map((f) => `${f.id}: ${f.message}`).join('\n');
    expect(failures, summary || 'all scenarios pass').toEqual([]);
  });

  it.each(JIRA_SYNC_FLOW_SCENARIOS.map((s) => [s.id, s] as const))('%s', (_id, scenario) => {
    const { ok, matchedRuleName } = evaluateFlowScenario(scenario);
    expect(ok, matchedRuleName ?? 'null').toBe(true);
  });
});

describe('matchRule prState guard', () => {
  const base: PullRequestContext = {
    event: 'pull_request',
    action: 'edited',
    pr: {
      title: 'PROJ-1',
      headRef: 'proj-1',
      body: null,
      htmlUrl: 'https://example.com/pr/1',
      merged: false,
      draft: false,
      state: 'closed',
      baseRef: 'dev',
      headRepoFullName: 'org/repo',
      labels: [],
      authorLogin: 'dev',
    },
    repository: 'org/repo',
    url: 'https://example.com/pr/1',
  };

  it('blocks In Review transition when PR is closed', () => {
    const readyWhen = {
      action: ['opened', 'reopened', 'ready_for_review', 'synchronize', 'edited'],
      prState: 'open' as const,
      notDraft: true,
    };
    expect(conditionsMatch(readyWhen, base, null)).toBe(false);
  });
});

