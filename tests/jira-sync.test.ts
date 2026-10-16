import { describe, expect, it } from 'vitest';

import { parseGitHubEvent } from '../lib/adapters/github/parseEvent';
import { config, If, ReviewAct, When } from '../lib/config';
import { compileConfig } from '../lib/config/compileConfig';
import { validateBuiltSyncConfig } from '../lib/config/validateConfig';
import { conditionsMatch } from '../lib/engine/matchRule';
import type { IssueCommentContext, PullRequestContext } from '../lib/engine/types';
import { createIssueKeyExtractor } from '../lib/utils/issueKey';
import { parseDeployEnvironment } from '../lib/utils/deployEnvironment';
import { pickTransition } from '../lib/utils/pickTransition';
import { formatMessage } from '../lib/utils/formatMessage';
import { builtSyncConfig } from '../settings';

const compiled = compileConfig(builtSyncConfig);

describe('issueKey', () => {
  const extract = createIssueKeyExtractor(compiled.issueKeyPattern);

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

  it('matches keys next to underscores and normalizes case', () => {
    expect(extract.extractAll({ branch: 'PROJ-123_login-fix' })).toEqual(['PROJ-123']);
    expect(extract.extractAll({ branch: 'feature_proj-7' })).toEqual(['PROJ-7']);
  });

  it('does not match inside longer keys or numbers', () => {
    expect(extract.extractAll({ title: 'XPROJ-1 and 1PROJ-2' })).toEqual([]);
    expect(extract.extractAll({ title: 'PROJ-1234 done' })).toEqual(['PROJ-1234']);
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

  it('ignores branch names that collide with Object.prototype keys', () => {
    expect(
      parseDeployEnvironment(
        [],
        'constructor',
        compiled.deployJobPattern,
        compiled.branchToDeployEnv,
        compiled.deployEnvToStatus
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

  it('formatMessage leaves unknown and prototype keys as written', () => {
    expect(formatMessage('{missing} {constructor}', {})).toBe('{missing} {constructor}');
  });

  it('review rules accept PR branch/label/author filters', () => {
    const built = config('PROJ')
      .messages({ note: 'Reviewed: {url}' })
      .when(When.PullRequestReview)
      .if(If.Action, ReviewAct.Submitted)
      .if(If.BaseRef, 'main')
      .if(If.Author, 'octocat')
      .comment('note')
      .build();
    expect(built.rules[0]?.when).toEqual({
      action: 'submitted',
      baseRef: 'main',
      author: 'octocat',
    });
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

  it('PR-only filters on issue_comment rules never match plain issue comments', () => {
    const comment: IssueCommentContext = {
      event: 'issue_comment',
      action: 'created',
      body: 'PROJ-1 note',
      pullRequestNumber: null,
      pr: null,
      repository: 'org/repo',
      url: 'https://example.com/issue/1#c1',
    };
    expect(conditionsMatch({ action: 'created', baseRef: 'main' }, comment, null)).toBe(false);
    expect(conditionsMatch({ action: 'created', label: 'bug' }, comment, null)).toBe(false);
    expect(conditionsMatch({ action: 'created' }, comment, null)).toBe(true);

    const onPr: IssueCommentContext = {
      ...comment,
      pullRequestNumber: 1,
      pr: { ...prCtx('opened').pr, baseRef: 'main' },
    };
    expect(conditionsMatch({ action: 'created', baseRef: 'main' }, onPr, null)).toBe(true);
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

  it('defaults a null workflow_run head_branch to empty string', () => {
    const parsed = parseGitHubEvent('workflow_run', {
      workflow_run: {
        name: 'Deploy',
        event: 'workflow_dispatch',
        conclusion: 'startup_failure',
        head_sha: 'abc',
        head_branch: null,
        html_url: 'https://github.com/o/r/actions/runs/2',
        id: 100,
      },
    });
    expect(parsed?.kind === 'workflow_run' && parsed.headBranch).toBe('');
  });

  it('treats a deleted head repository as a fork instead of crashing', () => {
    const parsed = parseGitHubEvent('pull_request', {
      action: 'closed',
      pull_request: {
        title: 'PROJ-1',
        body: null,
        html_url: 'https://github.com/o/r/pull/1',
        merged: false,
        draft: false,
        head: { ref: 'feat', repo: null },
        base: { ref: 'dev' },
      },
    });
    expect(parsed?.kind === 'pull_request' && parsed.pr.headRepoFullName).toBe('');
  });

  it('issue_comment exposes the PR number (GitHub sends no PR details)', () => {
    const onPr = parseGitHubEvent('issue_comment', {
      action: 'created',
      comment: { body: 'PROJ-5 looks good', html_url: 'https://github.com/o/r/pull/5#c1' },
      issue: { number: 5, title: 'PROJ-5', pull_request: { url: 'https://api.github.com/...' } },
    });
    expect(onPr).toMatchObject({ kind: 'issue_comment', pullRequestNumber: 5 });

    const onIssue = parseGitHubEvent('issue_comment', {
      action: 'created',
      comment: { body: 'PROJ-5 also', html_url: 'https://github.com/o/r/issues/6#c2' },
      issue: { number: 6, title: 'Bug' },
    });
    expect(onIssue).toMatchObject({ kind: 'issue_comment', pullRequestNumber: null });
  });

  it('check_run reads its branch from check_suite.head_branch', () => {
    const parsed = parseGitHubEvent('check_run', {
      action: 'completed',
      check_run: {
        name: 'build',
        conclusion: 'failure',
        head_sha: 'abc',
        html_url: 'https://github.com/o/r/runs/1',
        check_suite: { head_branch: 'feature/PROJ-3' },
      },
    });
    expect(parsed?.kind === 'check_run' && parsed.headBranch).toBe('feature/PROJ-3');
  });

  it('merge_group strips refs/heads/ and keeps the head commit message', () => {
    const parsed = parseGitHubEvent('merge_group', {
      action: 'checks_requested',
      merge_group: {
        head_sha: 'abc',
        head_ref: 'refs/heads/gh-readonly-queue/main/pr-4-abc',
        base_ref: 'refs/heads/main',
        head_commit: { message: 'PROJ-4 Add login (#4)' },
      },
    });
    expect(parsed).toMatchObject({
      kind: 'merge_group',
      baseRef: 'main',
      headRef: 'gh-readonly-queue/main/pr-4-abc',
      commitMessage: 'PROJ-4 Add login (#4)',
    });
  });

  it('release falls back to the tag when the name is empty', () => {
    const parsed = parseGitHubEvent('release', {
      action: 'published',
      release: { tag_name: 'v1.2.0', name: '', html_url: 'https://github.com/o/r/releases/v1.2.0' },
    });
    expect(parsed?.kind === 'release' && parsed.releaseName).toBe('v1.2.0');
  });
});

