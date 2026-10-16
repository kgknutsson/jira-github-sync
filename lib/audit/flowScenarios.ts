/**
 * Table-driven regression scenarios for rule matching (no live Jira/GitHub).
 *
 * Used by unit tests and {@link runJiraSyncFlowScenarioAudit}.
 *
 * @module audit/flowScenarios
 */
import { RunEnd, RunTrigger } from '../config/syncCatalog';
import { builtSyncConfig } from '../../settings';
import { findMatchingRule } from '../engine/matchRule';
import type { SyncEventContext } from '../engine/types';
import type { PullRequestRef } from '../adapters/github/types';

/** One expected rule-match case for regression tests. */
export type FlowScenario = {
  id: string;
  description: string;
  ctx: SyncEventContext;
  jiraStatus: string | null;
  /** Expected rule name from settings.ts, or null if sync should no-op at match stage */
  expectRuleName: string | null;
};

function pr(partial: Partial<PullRequestRef> & Pick<PullRequestRef, 'title'>): PullRequestRef {
  return {
    headRef: 'PROJ-1-branch',
    body: null,
    htmlUrl: 'https://example.com/pr/1',
    merged: false,
    draft: false,
    baseRef: 'dev',
    headRepoFullName: 'org/repo',
    state: 'open',
    labels: [],
    authorLogin: 'octocat',
    ...partial,
  };
}

const repo = 'org/repo';

/** Regression scenarios for first-match rule engine (no Jira/GitHub I/O). */
export const JIRA_SYNC_FLOW_SCENARIOS: FlowScenario[] = [
  {
    id: 'pr-opened-ready',
    description: 'Opened non-draft PR → In Review',
    ctx: {
      event: 'pull_request',
      action: 'opened',
      pr: pr({ title: 'PROJ-1 feature' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Progress',
    expectRuleName: 'PR ready → In Review',
  },
  {
    id: 'pr-opened-draft',
    description: 'Opened as draft → In Progress',
    ctx: {
      event: 'pull_request',
      action: 'opened',
      pr: pr({ title: 'PROJ-1 feature', draft: true }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'Ready for Development',
    expectRuleName: 'PR opened as draft → In Progress',
  },
  {
    id: 'pr-closed-edited-no-reopen',
    description: 'Edited closed PR must not move to In Review',
    ctx: {
      event: 'pull_request',
      action: 'edited',
      pr: pr({ title: 'PROJ-1 feature', state: 'closed' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Progress',
    expectRuleName: null,
  },
  {
    id: 'pr-closed-merged-comment',
    description: 'Merged close → comment only',
    ctx: {
      event: 'pull_request',
      action: 'closed',
      pr: pr({ title: 'PROJ-1 feature', state: 'closed', merged: true, baseRef: 'main' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Review',
    expectRuleName: 'PR merged to main → Done',
  },
  {
    id: 'pr-closed-not-merged',
    description: 'Closed without merge → no rule',
    ctx: {
      event: 'pull_request',
      action: 'closed',
      pr: pr({ title: 'PROJ-1 feature', state: 'closed', merged: false }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Review',
    expectRuleName: null,
  },
  {
    id: 'review-changes-open',
    description: 'Changes requested on open PR',
    ctx: {
      event: 'pull_request_review',
      action: 'submitted',
      reviewState: 'changes_requested',
      pr: pr({ title: 'PROJ-1 feature' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Review',
    expectRuleName: 'Changes requested → In Progress',
  },
  {
    id: 'review-changes-closed',
    description: 'Changes requested on closed PR → ignore',
    ctx: {
      event: 'pull_request_review',
      action: 'submitted',
      reviewState: 'changes_requested',
      pr: pr({ title: 'PROJ-1 feature', state: 'closed' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Review',
    expectRuleName: null,
  },
  {
    id: 'qg-fail-in-review-pr-run',
    description: 'QG failed on PR run while In Review',
    ctx: {
      event: 'workflow_run',
      workflowName: 'Quality Gate',
      runEvent: RunTrigger.PullRequest,
      conclusion: RunEnd.Failure,
      headSha: 'abc',
      headBranch: 'feature/proj-1',
      runUrl: 'https://example.com/run/1',
      runId: 1,
    },
    jiraStatus: 'In Review',
    expectRuleName: 'Quality gate failed (in review) → In Progress',
  },
  {
    id: 'qg-fail-push-run',
    description: 'Nested/push QG failure must not use PR-only rules',
    ctx: {
      event: 'workflow_run',
      workflowName: 'Quality Gate',
      runEvent: 'push',
      conclusion: RunEnd.Failure,
      headSha: 'abc',
      headBranch: 'dev',
      runUrl: 'https://example.com/run/2',
      runId: 2,
    },
    jiraStatus: 'In Review',
    expectRuleName: null,
  },
  {
    id: 'deploy-cancelled',
    description: 'Cancelled deploy → failure comment path',
    ctx: {
      event: 'workflow_run',
      workflowName: 'Deploy',
      runEvent: 'push',
      conclusion: RunEnd.Cancelled,
      headSha: 'abc',
      headBranch: 'dev',
      runUrl: 'https://example.com/run/3',
      runId: 3,
    },
    jiraStatus: 'In Progress',
    expectRuleName: 'Deploy failed → comment',
  },
  {
    id: 'deploy-in-progress-null',
    description: 'workflow_run without terminal conclusion → no rule',
    ctx: {
      event: 'workflow_run',
      workflowName: 'Deploy',
      runEvent: 'push',
      conclusion: null,
      headSha: 'abc',
      headBranch: 'dev',
      runUrl: 'https://example.com/run/4',
      runId: 4,
    },
    jiraStatus: 'In Progress',
    expectRuleName: null,
  },
  {
    id: 'pr-merged-dev-comment',
    description: 'Merged to dev → comment only (not Done)',
    ctx: {
      event: 'pull_request',
      action: 'closed',
      pr: pr({ title: 'PROJ-1 feature', state: 'closed', merged: true, baseRef: 'dev' }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Review',
    expectRuleName: 'PR merged → comment',
  },
  {
    id: 'pr-skip-jira-label',
    description: 'skip-jira label blocks In Review transition',
    ctx: {
      event: 'pull_request',
      action: 'opened',
      pr: pr({ title: 'PROJ-1 feature', labels: ['skip-jira'] }),
      repository: repo,
      url: 'https://example.com/pr/1',
    },
    jiraStatus: 'In Progress',
    expectRuleName: null,
  },
];

/** Evaluates one scenario against live `settings.ts` rules (test helper). */
export function evaluateFlowScenario(scenario: FlowScenario): {
  matchedRuleName: string | null;
  ok: boolean;
} {
  const rule = findMatchingRule(builtSyncConfig, scenario.ctx, scenario.jiraStatus);
  const matchedRuleName = rule?.name ?? null;
  return {
    matchedRuleName,
    ok: matchedRuleName === scenario.expectRuleName,
  };
}

/** Returns failures when any scenario's expected rule name does not match. */
export function runJiraSyncFlowScenarioAudit(): { id: string; message: string }[] {
  const failures: { id: string; message: string }[] = [];
  for (const scenario of JIRA_SYNC_FLOW_SCENARIOS) {
    const { matchedRuleName, ok } = evaluateFlowScenario(scenario);
    if (!ok) {
      failures.push({
        id: scenario.id,
        message: `${scenario.description}: expected rule ${scenario.expectRuleName ?? 'null'}, got ${matchedRuleName ?? 'null'}`,
      });
    }
  }
  return failures;
}
