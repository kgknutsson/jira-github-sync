import { describe, expect, it } from 'vitest';

import { parseGitHubEvent } from '../lib/adapters/github/parseEvent';
import { compileConfig } from '../lib/config/compileConfig';
import { validateBuiltSyncConfig } from '../lib/config/validateConfig';
import { conditionsMatch } from '../lib/engine/matchRule';
import type { PullRequestContext } from '../lib/engine/types';
import { createIssueKeyExtractor } from '../lib/utils/issueKey';
import { parseDeployEnvironment } from '../lib/utils/deployEnvironment';
import { pickTransition } from '../lib/utils/pickTransition';
import { formatMessage } from '../lib/utils/formatMessage';
import { builtSyncConfig } from '../settings';

const compiled = compileConfig(builtSyncConfig);

describe('issueKey', () => {
  const extract = createIssueKeyExtractor('PROJ', compiled.issueKeyPattern);

  it('finds key in PR title first', () => {
    expect(
      extract.extract({
        title: 'PROJ-116 Playwright tests',
        branch: 'feature/PROJ-99-other',
      })
    ).toBe('PROJ-116');
  });

  it('falls back to body then branch', () => {
    expect(extract.extract({ title: 'Fix bug', branch: 'PROJ-42-fix' })).toBe('PROJ-42');
    expect(extract.extract({ body: 'See PROJ-7 for context', branch: 'PROJ-99-other' })).toBe(
      'PROJ-7'
    );
  });

  it('prefers commit message keys before branch keys', () => {
    expect(extract.extractAll({ branch: 'PROJ-1-fix', commitMessage: 'PROJ-2 ship fix' })).toEqual([
      'PROJ-2',
      'PROJ-1',
    ]);
  });

  it('extractAll dedupes and preserves order', () => {
    expect(
      extract.extractAll({
        title: 'PROJ-1 and PROJ-2',
        branch: 'PROJ-2-other',
        commitMessage: 'PROJ-1 follow-up',
      })
    ).toEqual(['PROJ-1', 'PROJ-2']);
  });

  it('finds key in commit message', () => {
    expect(extract.extract({ commitMessage: 'Merge pull request #9\n\nPROJ-99 fix' })).toBe(
      'PROJ-99'
    );
  });
});

describe('pickTransition', () => {
  const transitions = [
    { id: '3', name: 'Start review', to: { name: 'In Review' } },
    { id: '27', name: 'Deployed (Dev)', to: { name: 'Deployed (Dev)' } },
  ];

  it('prefers named transition', () => {
    expect(pickTransition(transitions, 'In Review', ['Start review'])?.id).toBe('3');
  });

  it('matches by target status', () => {
    expect(pickTransition(transitions, 'Deployed (Dev)', [])?.name).toBe('Deployed (Dev)');
  });

  it('ignores preferred name when it leads to a different status', () => {
    const mixed = [
      { id: '1', name: 'Start review', to: { name: 'Wrong' } },
      { id: '2', name: 'Go Review', to: { name: 'In Review' } },
    ];
    expect(pickTransition(mixed, 'In Review', ['Start review'])?.id).toBe('2');
  });
});

describe('parseDeployEnvironment', () => {
  it('parses job name and branch fallback', () => {
    expect(
      parseDeployEnvironment(
        [{ name: 'Build and Deploy (test)' }],
        'dev',
        compiled.deployJobPattern,
        compiled.branchToDeployEnv,
        compiled.deployEnvToStatus
      )
    ).toBe('test');
    expect(
      parseDeployEnvironment(
        [],
        'main',
        compiled.deployJobPattern,
        compiled.branchToDeployEnv,
        compiled.deployEnvToStatus
      )
    ).toBe('prod');
  });

  it('skips branch fallback when disabled (manual workflow_dispatch)', () => {
    expect(
      parseDeployEnvironment(
        [],
        'main',
        compiled.deployJobPattern,
        compiled.branchToDeployEnv,
        compiled.deployEnvToStatus,
        { allowBranchFallback: false }
      )
    ).toBeNull();
  });
});

describe('settings DSL', () => {
  it('builds named rules', () => {
    expect(builtSyncConfig.rules[0]?.name).toBe('PR ready → In Review');
    expect(builtSyncConfig.rules.length).toBeGreaterThanOrEqual(11);
  });

  it('passes config validation', () => {
    const errors = validateBuiltSyncConfig(builtSyncConfig).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('includes runtime options', () => {
    expect(builtSyncConfig.options.resolveKeyFromCommitMessage).toBe(true);
    expect(builtSyncConfig.options.skipMarker).toBe('[skip-jira]');
  });

  it('compileConfig exposes deploy map', () => {
    expect(compiled.deployEnvToStatus.dev).toBe('Deployed (Dev)');
    expect(compiled.deployEnvToStatus.prod).toBe('Done');
  });

  it('formatMessage replaces placeholders', () => {
    expect(formatMessage('Hi {name}', { name: 'there' })).toBe('Hi there');
  });
});

describe('matchRule', () => {
  const prCtx = (action: string, draft = false): PullRequestContext => ({
    event: 'pull_request',
    action,
    pr: {
      title: 'PROJ-1',
      headRef: 'PROJ-1',
      body: null,
      htmlUrl: 'https://example.com/pr/1',
      merged: false,
      draft,
      state: 'open',
      baseRef: 'dev',
      headRepoFullName: 'org/repo',
      labels: [],
      authorLogin: 'dev',
    },
    repository: 'org/repo',
    url: 'https://example.com/pr/1',
  });

  it('matches first PR rule when not draft', () => {
    const rule = builtSyncConfig.rules.find((r) => r.name === 'PR ready → In Review');
    expect(rule).toBeDefined();
    expect(conditionsMatch(rule!.when, prCtx('opened'), null)).toBe(true);
    expect(conditionsMatch(rule!.when, prCtx('opened', true), null)).toBe(false);
  });
});

describe('parseGitHubEvent', () => {
  it('derives merged from merged_at when merged flag absent', () => {
    const parsed = parseGitHubEvent('pull_request', {
      action: 'closed',
      pull_request: {
        title: 'PROJ-1',
        body: null,
        html_url: 'https://github.com/o/r/pull/1',
        merged_at: '2026-01-01T00:00:00Z',
        draft: false,
        head: { ref: 'feat', repo: { full_name: 'o/r' } },
        base: { ref: 'dev' },
      },
    });
    expect(parsed?.kind).toBe('pull_request');
    if (parsed?.kind === 'pull_request') {
      expect(parsed.pr.merged).toBe(true);
    }
  });

  it('parses workflow_run', () => {
    const parsed = parseGitHubEvent('workflow_run', {
      workflow_run: {
        name: 'Deploy',
        event: 'push',
        conclusion: 'success',
        head_sha: 'abc',
        head_branch: 'dev',
        html_url: 'https://github.com/o/r/actions/runs/1',
        id: 99,
      },
    });
    expect(parsed?.kind).toBe('workflow_run');
    if (parsed?.kind === 'workflow_run') {
      expect(parsed.runEvent).toBe('push');
    }
  });
});

