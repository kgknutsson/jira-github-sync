import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTransitionAction } from '../lib/actions/transitionAction';
import { addIssueRemoteLink, type JiraConfig } from '../lib/adapters/jira/client';
import { compileConfig } from '../lib/config/compileConfig';
import { parseConfigText } from '../lib/config/configFile';
import type { TransitionStep } from '../lib/config/types';
import { runSyncForContext } from '../lib/engine/runSync';
import type { CheckSuiteContext, IssueCommentContext } from '../lib/engine/types';

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

describe('remote links', () => {
  it('send the URL as globalId so repeated runs update instead of duplicating', async () => {
    const url = 'https://github.com/org/repo/pull/1';
    const calls = stubFetch({ [`POST ${JIRA}/rest/api/3/issue/PROJ-1/remotelink`]: { id: 1 } });

    await addIssueRemoteLink(jira, 'PROJ-1', url, 'GitHub pull request');

    expect(calls[0]?.body).toEqual({ globalId: url, object: { url, title: 'GitHub pull request' } });
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
