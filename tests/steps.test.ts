import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTransitionAction } from '../lib/actions/transitionAction';
import {
  addIssueRemoteLink,
  explainIssueNotFound,
  type JiraConfig,
  missingJiraCredentials,
  readJiraConfigFromEnv,
} from '../lib/adapters/jira/client';
import { compileConfig } from '../lib/config/compileConfig';
import { parseConfigText } from '../lib/config/configFile';
import type { TransitionStep } from '../lib/config/types';
import { runSyncForContext } from '../lib/engine/runSync';
import type { CheckSuiteContext, IssueCommentContext, WorkflowRunContext } from '../lib/engine/types';

type FetchCall = { method: string; url: string; body: unknown };

const JIRA = 'https://jira.test';
const jira: JiraConfig = { baseUrl: JIRA, email: 'bot@example.com', apiToken: 'token' };

/** Compiles a rules file given as YAML lines. */
function compileYaml(...lines: string[]) {
  const { config, issues } = parseConfigText(lines.join('\n'));
  if (!config) throw new Error(JSON.stringify(issues));
  return compileConfig(config);
}

/** Routes `METHOD url` to a JSON body; unrouted requests get a 404. */
function stubFetch(routes: Record<string, unknown>): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url}`;
    if (!(key in routes)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

function commentText(calls: FetchCall[]): string {
  const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/comment'));
  return JSON.stringify(call?.body ?? null);
}

beforeEach(() => {
  vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('transition comments', () => {
  it('fill {url} for events without a PR or run URL (check_suite)', async () => {
    const compiled = compileYaml(
      'projectKey: PROJ',
      "messages: { failed: 'CI failed ({checkName}): {url}' }",
      'rules:',
      '  - name: External CI failed',
      '    when: check_suite',
      '    if: { conclusion: failure }',
      '    transitionTo: In Progress',
      '    commentOnIssue: true',
      '    commentAfterSuccess: failed'
    );
    const event: CheckSuiteContext = {
      event: 'check_suite',
      action: 'completed',
      conclusion: 'failure',
      checkName: 'CircleCI Checks',
      headSha: 'abc123',
      headBranch: 'PROJ-1-fix',
      repository: 'org/repo',
    };
    const calls = stubFetch({
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1/transitions`]: {
        transitions: [{ id: '5', name: 'Back to work', to: { name: 'In Progress' } }],
      },
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/transitions`]: {},
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/comment`]: {},
    });

    const result = await runTransitionAction(compiled.built.rules[0]!.then as TransitionStep, {
      jira,
      compiled,
      issueKey: 'PROJ-1',
      event,
      jiraStatus: 'In Review',
    });

    expect(result).toBe('ok');
    expect(commentText(calls)).toContain(
      'CI failed (CircleCI Checks): https://github.com/org/repo/commit/abc123/checks'
    );
  });
});

describe('commentOnIssue', () => {
  it('skips comment-only rules when commentOnIssue is false', async () => {
    const compiled = compileYaml(
      'projectKey: PROJ',
      "messages: { merged: 'Merged: {url}' }",
      'rules:',
      '  - name: Comment rule',
      '    when: release',
      '    if: { action: published }',
      '    comment: merged',
      '    commentOnIssue: false'
    );
    const calls = stubFetch({ [`POST ${JIRA}/rest/api/3/issue/PROJ-1/comment`]: {} });
    const step = compiled.built.rules[0]!.then;
    if (step.kind !== 'comment') throw new Error('expected comment step');
    const { runCommentAction } = await import('../lib/actions/commentAction');
    await runCommentAction(step, {
      jira,
      compiled,
      issueKey: 'PROJ-1',
      jiraStatus: 'In Review',
      event: {
        event: 'release',
        action: 'published',
        tagName: 'v1',
        releaseName: 'v1',
        releaseUrl: 'https://github.com/org/repo/releases/tag/v1',
        repository: 'org/repo',
      },
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/comment'))).toBe(false);
  });

  it('skips transition commentAfterSuccess without commentOnIssue', async () => {
    const compiled = compileYaml(
      'projectKey: PROJ',
      "messages: { note: 'Moved: {url}' }",
      'rules:',
      '  - name: Move',
      '    when: release',
      '    if: { action: published }',
      '    transitionTo: Done',
      '    commentAfterSuccess: note'
    );
    const calls = stubFetch({
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1/transitions`]: {
        transitions: [{ id: '1', name: 'Done', to: { name: 'Done' } }],
      },
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/transitions`]: {},
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/comment`]: {},
    });
    const step = compiled.built.rules[0]!.then as TransitionStep;
    await runTransitionAction(step, {
      jira,
      compiled,
      issueKey: 'PROJ-1',
      jiraStatus: 'In Review',
      event: {
        event: 'release',
        action: 'published',
        tagName: 'v1',
        releaseName: 'v1',
        releaseUrl: 'https://github.com/org/repo/releases/tag/v1',
        repository: 'org/repo',
      },
    });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/comment'))).toBe(false);
  });
});

describe('remote links', () => {
  it('send the URL as globalId on first link', async () => {
    const url = 'https://github.com/org/repo/pull/1';
    const calls = stubFetch({
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1/remotelink`]: [],
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/remotelink`]: { id: 1 },
    });

    await addIssueRemoteLink(jira, 'PROJ-1', url, 'GitHub pull request');

    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      globalId: url,
      object: { url, title: 'GitHub pull request' },
    });
  });

  it('skip POST when the URL is already linked', async () => {
    const url = 'https://github.com/org/repo/pull/1';
    const calls = stubFetch({
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1/remotelink`]: [{ globalId: url, object: { url, title: 'GitHub pull request' } }],
    });

    await addIssueRemoteLink(jira, 'PROJ-1', url, 'GitHub pull request');

    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('issue_comment on a pull request', () => {
  const compiled = compileYaml(
    'projectKey: PROJ',
    "messages: { note: 'Comment on {prUrl} targeting {baseRef}' }",
    'rules:',
    '  - name: PR comment',
    '    when: issue_comment',
    '    if: { action: created, baseRef: main }',
    '    comment: note'
  );
  const event: IssueCommentContext = {
    event: 'issue_comment',
    action: 'created',
    body: 'Looks good',
    pullRequestNumber: 7,
    pr: null,
    repository: 'org/repo',
    url: 'https://github.com/org/repo/pull/7#issuecomment-1',
  };
  const pullRequest = (headRepo: string) => ({
    title: 'PROJ-9 Fix login',
    body: null,
    html_url: 'https://github.com/org/repo/pull/7',
    merged_at: null,
    draft: false,
    state: 'open',
    head: { ref: 'fix-login', repo: { full_name: headRepo } },
    base: { ref: 'main' },
    labels: [],
    user: { login: 'octocat' },
  });

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'gh-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('JIRA_BASE_URL', JIRA);
    vi.stubEnv('JIRA_USER_EMAIL', 'bot@example.com');
    vi.stubEnv('JIRA_API_TOKEN', 'token');
  });

  it('fetches the PR so branch filters and PR-title keys work', async () => {
    const calls = stubFetch({
      'GET https://api.github.com/repos/org/repo/pulls/7': pullRequest('org/repo'),
      [`GET ${JIRA}/rest/api/3/issue/PROJ-9?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`POST ${JIRA}/rest/api/3/issue/PROJ-9/comment`]: {},
    });

    await runSyncForContext(compiled, event);

    expect(commentText(calls)).toContain(
      'Comment on https://github.com/org/repo/pull/7 targeting main'
    );
  });

  it('skips comments on fork pull requests', async () => {
    const calls = stubFetch({
      'GET https://api.github.com/repos/org/repo/pulls/7': pullRequest('someone/fork'),
    });

    await runSyncForContext(compiled, event);

    expect(calls.some((c) => c.url.startsWith(JIRA))).toBe(false);
  });
});

describe('pull request runs for superseded commits', () => {
  const compiled = compileYaml(
    'projectKey: PROJ',
    'rules:',
    '  - name: QG failed',
    '    when: workflow_run',
    '    if: { workflow: Quality Gate, runEvent: pull_request, conclusion: failure }',
    '    ifJiraStatus: In Review',
    '    transitionTo: In Progress'
  );
  const qualityGateFailed = (headSha: string): WorkflowRunContext => ({
    event: 'workflow_run',
    workflowName: 'Quality Gate',
    runEvent: 'pull_request',
    conclusion: 'failure',
    headSha,
    headBranch: 'fix-login',
    runUrl: 'https://github.com/org/repo/actions/runs/1',
    runId: 1,
    repository: 'org/repo',
  });
  const openPr = {
    title: 'PROJ-9 Fix login',
    body: null,
    html_url: 'https://github.com/org/repo/pull/7',
    merged_at: null,
    draft: false,
    state: 'open',
    head: { ref: 'fix-login', sha: 'new-sha', repo: { full_name: 'org/repo' } },
    base: { ref: 'dev' },
    labels: [],
    user: { login: 'octocat' },
  };

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'gh-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('JIRA_BASE_URL', JIRA);
    vi.stubEnv('JIRA_USER_EMAIL', 'bot@example.com');
    vi.stubEnv('JIRA_API_TOKEN', 'token');
  });

  it('ignores a result for a commit the pull request has moved past', async () => {
    const calls = stubFetch({ 'GET https://api.github.com/repos/org/repo/commits/old-sha/pulls': [openPr] });

    await runSyncForContext(compiled, qualityGateFailed('old-sha'));

    expect(calls.some((c) => c.url.startsWith(JIRA))).toBe(false);
  });

  it("acts on the result for the pull request's latest commit", async () => {
    const calls = stubFetch({
      'GET https://api.github.com/repos/org/repo/commits/new-sha/pulls': [openPr],
      'GET https://api.github.com/repos/org/repo/commits/new-sha': { commit: { message: 'PROJ-9 Fix login' } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-9?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-9/transitions`]: {
        transitions: [{ id: '5', name: 'Rework', to: { name: 'In Progress' } }],
      },
      [`POST ${JIRA}/rest/api/3/issue/PROJ-9/transitions`]: {},
    });

    await runSyncForContext(compiled, qualityGateFailed('new-sha'));

    expect(calls).toContainEqual({
      method: 'POST',
      url: `${JIRA}/rest/api/3/issue/PROJ-9/transitions`,
      body: { transition: { id: '5' } },
    });
  });
});

describe('Jira credentials', () => {
  it('trims pasted secrets and the trailing slash of the base URL', () => {
    vi.stubEnv('JIRA_BASE_URL', ' https://jira.test/ \n');
    vi.stubEnv('JIRA_USER_EMAIL', 'bot@example.com\n');
    vi.stubEnv('JIRA_API_TOKEN', 'token\r\n');
    expect(readJiraConfigFromEnv()).toEqual(jira);
  });

  it('reports blank secrets as missing', () => {
    vi.stubEnv('JIRA_BASE_URL', JIRA);
    vi.stubEnv('JIRA_USER_EMAIL', '  ');
    vi.stubEnv('JIRA_API_TOKEN', '');
    expect(missingJiraCredentials()).toEqual(['JIRA_USER_EMAIL', 'JIRA_API_TOKEN']);
    expect(readJiraConfigFromEnv()).toBeNull();
  });

  it('uses the site root of a pasted Jira Cloud page URL, and keeps other paths', () => {
    vi.stubEnv('JIRA_USER_EMAIL', 'bot@example.com');
    vi.stubEnv('JIRA_API_TOKEN', 'token');
    vi.stubEnv('JIRA_BASE_URL', 'https://site.atlassian.net/jira/software/projects/PROJ/boards/1');
    expect(readJiraConfigFromEnv()?.baseUrl).toBe('https://site.atlassian.net');
    vi.stubEnv('JIRA_BASE_URL', 'https://api.atlassian.com/ex/jira/cloud-id/');
    expect(readJiraConfigFromEnv()?.baseUrl).toBe('https://api.atlassian.com/ex/jira/cloud-id');
  });
});

describe('comment-only rules with recent-commit scan', () => {
  const compiled = compileYaml(
    'projectKey: PROJ',
    "messages: { deployFailed: 'Deploy failed {url}' }",
    'options:',
    '  resolveKeysFromRecentCommits: 10',
    'rules:',
    '  - name: Deploy failed → comment',
    '    when: workflow_run',
    '    if: { workflow: Deploy App, runEvent: push, conclusion: failure }',
    '    comment: deployFailed'
  );
  const deployFailed: WorkflowRunContext = {
    event: 'workflow_run',
    workflowName: 'Deploy App',
    runEvent: 'push',
    conclusion: 'failure',
    headSha: 'head1',
    headBranch: 'test',
    runUrl: 'https://github.com/org/repo/actions/runs/99',
    runId: 99,
    repository: 'org/repo',
  };

  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'gh-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
    vi.stubEnv('JIRA_BASE_URL', JIRA);
    vi.stubEnv('JIRA_USER_EMAIL', 'bot@example.com');
    vi.stubEnv('JIRA_API_TOKEN', 'token');
  });

  it('posts deploy-failed comments only for head commit keys, not every scanned key', async () => {
    const calls = stubFetch({
      'GET https://api.github.com/repos/org/repo/commits?sha=head1&per_page=10&page=1': [
        { sha: 'head1', commit: { message: 'PROJ-1 deploy head' } },
        { sha: 'old2', commit: { message: 'PROJ-2 older' } },
        { sha: 'old3', commit: { message: 'PROJ-3 older' } },
      ],
      'GET https://api.github.com/repos/org/repo/commits/head1': {
        commit: { message: 'PROJ-1 deploy head' },
      },
      'GET https://api.github.com/repos/org/repo/commits/head1/pulls': [],
      'GET https://api.github.com/repos/org/repo/commits/old2/pulls': [],
      'GET https://api.github.com/repos/org/repo/commits/old3/pulls': [],
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-2?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-3?fields=status`]: { fields: { status: { name: 'In Review' } } },
      [`POST ${JIRA}/rest/api/3/issue/PROJ-1/comment`]: {},
    });

    await runSyncForContext(compiled, deployFailed);

    const commentPosts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/comment'));
    expect(commentPosts).toHaveLength(1);
    expect(commentPosts[0]!.url).toContain('PROJ-1');
  });

  it('does not post commentWhenSkipped on every scanned key during deploy', async () => {
    const compiled = compileYaml(
      'projectKey: PROJ',
      "messages: { alreadyThere: 'Already deployed {url}' }",
      'options:',
      '  resolveKeysFromRecentCommits: 10',
      'deploy:',
      '  branchToEnvironment: { test: test }',
      '  environmentToJiraStatus: { test: Deployed (Test) }',
      'rules:',
      '  - name: Deploy success',
      '    when: workflow_run',
      '    if: { workflow: Deploy App, runEvent: push, conclusion: success }',
      '    deployToJiraStatus: true',
      '    commentOnIssue: true',
      '    commentWhenSkipped: alreadyThere'
    );
    const deployOk: WorkflowRunContext = {
      event: 'workflow_run',
      workflowName: 'Deploy App',
      runEvent: 'push',
      conclusion: 'success',
      headSha: 'head1',
      headBranch: 'test',
      runUrl: 'https://github.com/org/repo/actions/runs/99',
      runId: 99,
      repository: 'org/repo',
    };

    const calls = stubFetch({
      'GET https://api.github.com/repos/org/repo/commits?sha=head1&per_page=10&page=1': [
        { sha: 'head1', commit: { message: 'PROJ-1 deploy head' } },
        { sha: 'old2', commit: { message: 'PROJ-2 older' } },
      ],
      'GET https://api.github.com/repos/org/repo/commits/head1': {
        commit: { message: 'PROJ-1 deploy head' },
      },
      'GET https://api.github.com/repos/org/repo/commits/head1/pulls': [],
      'GET https://api.github.com/repos/org/repo/commits/old2/pulls': [],
      'GET https://api.github.com/repos/org/repo/actions/runs/99/jobs?per_page=100': {
        jobs: [{ name: 'Build and Deploy (test)' }],
      },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1?fields=status`]: {
        fields: { status: { name: 'Deployed (Test)' } },
      },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-2?fields=status`]: {
        fields: { status: { name: 'Deployed (Test)' } },
      },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-1/transitions`]: { transitions: [] },
      [`GET ${JIRA}/rest/api/3/issue/PROJ-2/transitions`]: { transitions: [] },
    });

    await runSyncForContext(compiled, deployOk);

    const commentPosts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/comment'));
    expect(commentPosts).toHaveLength(1);
    expect(commentPosts[0]!.url).toContain('PROJ-1');
  });
});

describe('explainIssueNotFound', () => {
  function myselfAnswers(status: number, contentType: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/myself')) {
          return new Response(status === 200 ? '{}' : 'err', {
            status,
            headers: { 'Content-Type': contentType },
          });
        }
        return new Response('not found', { status: 404 });
      })
    );
  }

  it('blames the login when /myself is rejected', async () => {
    myselfAnswers(401, 'application/json');
    expect(await explainIssueNotFound(jira, 'PROJ-1')).toContain('Jira rejected the login (HTTP 401)');
  });

  it('blames the base URL when /myself is not Jira', async () => {
    myselfAnswers(404, 'text/html');
    expect(await explainIssueNotFound(jira, 'PROJ-1')).toContain('JIRA_BASE_URL is not a Jira Cloud site');
  });

  it('blames the key or project access when the login works', async () => {
    myselfAnswers(200, 'application/json;charset=UTF-8');
    expect(await explainIssueNotFound(jira, 'PROJ-1')).toBe(
      'PROJ-1 does not exist, or the Jira account cannot browse its project.'
    );
  });
});
