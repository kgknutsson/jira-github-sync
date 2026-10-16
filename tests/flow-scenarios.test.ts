import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { PullRequestRef } from '../lib/adapters/github/types';
import { parseConfigText } from '../lib/config/configFile';
import { findMatchingRule } from '../lib/engine/matchRule';
import type { SyncEventContext } from '../lib/engine/types';

/** Which sample rule (if any) wins for typical events — first match, no Jira/GitHub I/O. */
const sample = parseConfigText(readFileSync('templates/jira-sync.config.yml', 'utf8')).config!;

function pullRequest(action: string, pr: Partial<PullRequestRef> = {}): SyncEventContext {
  return {
    event: 'pull_request',
    action,
    pr: {
      title: 'PROJ-1 feature',
      headRef: 'PROJ-1-branch',
      body: null,
      htmlUrl: 'https://example.com/pr/1',
      merged: false,
      draft: false,
      state: 'open',
      baseRef: 'dev',
      headRepoFullName: 'org/repo',
      labels: [],
      authorLogin: 'octocat',
      ...pr,
    },
    repository: 'org/repo',
    url: 'https://example.com/pr/1',
  };
}

function review(reviewState: string, state: 'open' | 'closed' = 'open'): SyncEventContext {
  const { pr } = pullRequest('opened', { state }) as Extract<SyncEventContext, { event: 'pull_request' }>;
  return { event: 'pull_request_review', action: 'submitted', reviewState, pr, repository: 'org/repo', url: pr.htmlUrl };
}

function workflowRun(workflowName: string, runEvent: string, conclusion: string | null): SyncEventContext {
  return {
    event: 'workflow_run',
    workflowName,
    runEvent,
    conclusion,
    headSha: 'abc',
    headBranch: 'PROJ-1-branch',
    runUrl: 'https://example.com/run/1',
    runId: 1,
  };
}

const release: SyncEventContext = {
  event: 'release',
  action: 'published',
  tagName: 'v1.0.0',
  releaseName: 'PROJ-1 release',
  releaseUrl: 'https://example.com/releases/v1.0.0',
  repository: 'org/repo',
};

const scenarios: [description: string, ctx: SyncEventContext, jiraStatus: string, expected: string | null][] = [
  ['opened, ready PR', pullRequest('opened'), 'In Progress', 'PR ready → In Review'],
  ['PR opened as draft', pullRequest('opened', { draft: true }), 'Ready for Development', 'PR opened as draft → In Progress'],
  ['edit on a closed PR does not reopen review', pullRequest('edited', { state: 'closed' }), 'In Progress', null],
  ['skip-jira label blocks In Review', pullRequest('opened', { labels: ['skip-jira'] }), 'In Progress', null],
  ['merged to main → Done (before the generic merge comment)', pullRequest('closed', { state: 'closed', merged: true, baseRef: 'main' }), 'In Review', 'PR merged to main → Done'],
  ['merged to dev → comment only', pullRequest('closed', { state: 'closed', merged: true }), 'In Review', 'PR merged → comment'],
  ['closed without merge', pullRequest('closed', { state: 'closed' }), 'In Review', null],
  ['changes requested on an open PR', review('changes_requested'), 'In Review', 'Changes requested → In Progress'],
  ['changes requested on a closed PR', review('changes_requested', 'closed'), 'In Review', null],
  ['approved review', review('approved'), 'In Review', 'PR approved → comment'],
  ['Quality Gate failed on a PR run while In Review', workflowRun('Quality Gate', 'pull_request', 'failure'), 'In Review', 'Quality gate failed (in review) → In Progress'],
  ['Quality Gate failed outside In Review', workflowRun('Quality Gate', 'pull_request', 'failure'), 'In Progress', 'Quality gate failed → comment only'],
  ['Quality Gate failed on a push run', workflowRun('Quality Gate', 'push', 'failure'), 'In Review', null],
  ['deploy succeeded', workflowRun('Deploy', 'push', 'success'), 'Done', 'Deploy success → environment status'],
  ['deploy cancelled', workflowRun('Deploy', 'push', 'cancelled'), 'In Progress', 'Deploy failed → comment'],
  ['workflow run without a conclusion', workflowRun('Deploy', 'push', null), 'In Progress', null],
  ['release published', release, 'Done', 'Release published → comment'],
];

describe('sample rules', () => {
  it.each(scenarios)('%s', (_description, ctx, jiraStatus, expected) => {
    expect(findMatchingRule(sample, ctx, jiraStatus)?.name ?? null).toBe(expected);
  });
});
