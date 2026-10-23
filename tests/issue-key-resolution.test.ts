import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveIssueKeysForPush,
  resolveIssueKeysForWorkflowRun,
} from '../lib/actions/issueKeyResolution';
import { DEFAULT_SYNC_OPTIONS } from '../lib/config/syncOptions';

describe('resolveIssueKeysForWorkflowRun', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'gh-token');
    vi.stubEnv('GITHUB_REPOSITORY', 'org/repo');
  });

  it('collects keys from multiple recent commits on a branch', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=aaa')) {
        return new Response(
          JSON.stringify([
            { sha: 'aaa', commit: { message: 'Merge dev into test' } },
            { sha: 'bbb', commit: { message: 'KCM-2 second' } },
            { sha: 'ccc', commit: { message: 'KCM-1 first' } },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/aaa/pulls')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/commits/bbb/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'KCM-2 Feature B',
              body: null,
              html_url: 'https://github.com/org/repo/pull/2',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature-b', repo: { full_name: 'org/repo' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/ccc/pulls')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; title?: string | null }) => {
      const text = [parts.title, parts.commitMessage].filter(Boolean).join('\n');
      return [...text.matchAll(pattern)].map((m) => m[0]!.toUpperCase());
    };

    const keys = await resolveIssueKeysForWorkflowRun('aaa', 'test', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 10,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-2', 'KCM-1']);
  });

  it('continues when listing pull requests for a commit returns 500', async () => {
    let pullsCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=only')) {
        return new Response(JSON.stringify([{ sha: 'only', commit: { message: 'KCM-9 fix' } }]), {
          status: 200,
        });
      }
      if (url.endsWith('/commits/only/pulls')) {
        pullsCalls += 1;
        if (pullsCalls === 1) return new Response(JSON.stringify([]), { status: 200 });
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null }) =>
      [...(parts.commitMessage ?? '').matchAll(pattern)].map((m) => m[0]!.toUpperCase());

    const keys = await resolveIssueKeysForWorkflowRun('only', 'staging', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 5,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-9']);
  });

  it('merges keys from commit message and linked PR during scans', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=mix')) {
        return new Response(JSON.stringify([{ sha: 'mix', commit: { message: 'KCM-1 tweak' } }]), {
          status: 200,
        });
      }
      if (url.endsWith('/commits/mix/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'KCM-2 Feature B',
              body: null,
              html_url: 'https://github.com/org/repo/pull/3',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature-b', repo: { full_name: 'org/repo' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; title?: string | null }) => {
      const text = [parts.title, parts.commitMessage].filter(Boolean).join('\n');
      return [...text.matchAll(pattern)].map((m) => m[0]!.toUpperCase());
    };

    const keys = await resolveIssueKeysForWorkflowRun('mix', 'test', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 5,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-1', 'KCM-2']);
  });

  it('ignores commit message keys when a linked PR contains the skip marker', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=skippr')) {
        return new Response(
          JSON.stringify([{ sha: 'skippr', commit: { message: 'KCM-9 ship it' } }]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/skippr/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'Feature',
              body: '[skip-jira]',
              html_url: 'https://github.com/org/repo/pull/9',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature', repo: { full_name: 'org/repo' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; body?: string | null }) =>
      [...[parts.commitMessage, parts.body].filter(Boolean).join('\n').matchAll(pattern)].map(
        (m) => m[0]!.toUpperCase()
      );

    const keys = await resolveIssueKeysForWorkflowRun('skippr', 'test', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 5,
      allowRecentCommitScan: true,
      skipMarker: '[skip-jira]',
    });

    expect(keys).toEqual([]);
  });

  it('uses push payload keys when recent-commit listing fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=head')) {
        return new Response('error', { status: 500 });
      }
      if (url.endsWith('/commits/pay1/pulls') || url.endsWith('/commits/pay2/pulls')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null }) =>
      [...(parts.commitMessage ?? '').matchAll(pattern)].map((m) => m[0]!.toUpperCase());

    const keys = await resolveIssueKeysForPush(
      'head',
      'test',
      ['KCM-3 from payload', 'chore: no key'],
      [{ sha: 'pay1', message: 'KCM-3 from payload' }, { sha: 'pay2', message: 'chore: no key' }],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: true,
        resolveKeysFromRecentCommits: 10,
        allowRecentCommitScan: true,
        skipMarker: null,
      }
    );

    expect(keys).toEqual(['KCM-3']);
  });

  it('does not use branch names when scan listing fails on push', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=head')) {
        return new Response('error', { status: 500 });
      }
      if (url.endsWith('/commits/pay1/pulls')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /PROJ-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; branch?: string | null }) =>
      [...[parts.commitMessage, parts.branch].filter(Boolean).join('\n').matchAll(pattern)].map(
        (m) => m[0]!.toUpperCase()
      );

    const keys = await resolveIssueKeysForPush(
      'head',
      'PROJ-999-test',
      ['PROJ-1 fix'],
      [{ sha: 'pay1', message: 'PROJ-1 fix' }],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: true,
        resolveKeysFromRecentCommits: 10,
        allowRecentCommitScan: true,
        skipMarker: null,
      }
    );

    expect(keys).toEqual(['PROJ-1']);
  });

  it('ignores payload commit message keys when linked PR has skip marker (list failed)', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=head')) {
        return new Response('error', { status: 500 });
      }
      if (url.endsWith('/commits/pay1/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'Feature',
              body: '[skip-jira]',
              html_url: 'https://github.com/org/repo/pull/1',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature', repo: { full_name: 'org/repo' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /PROJ-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; body?: string | null }) =>
      [...[parts.commitMessage, parts.body].filter(Boolean).join('\n').matchAll(pattern)].map(
        (m) => m[0]!.toUpperCase()
      );

    const keys = await resolveIssueKeysForPush(
      'head',
      'test',
      ['PROJ-9 fix'],
      [{ sha: 'pay1', message: 'PROJ-9 fix' }],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: true,
        resolveKeysFromRecentCommits: 10,
        allowRecentCommitScan: true,
        skipMarker: '[skip-jira]',
      }
    );

    expect(keys).toEqual([]);
  });

  it('skips keys from fork-linked commits during recent-commit scan', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=aaa')) {
        return new Response(
          JSON.stringify([
            { sha: 'aaa', commit: { message: 'Merge' } },
            { sha: 'forkc', commit: { message: 'KCM-99 fork' } },
            { sha: 'good', commit: { message: 'KCM-1 ok' } },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/aaa/pulls')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith('/commits/forkc/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'Fork PR',
              body: null,
              html_url: 'https://github.com/org/repo/pull/99',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature', repo: { full_name: 'other/fork' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/good/pulls')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null }) =>
      [...(parts.commitMessage ?? '').matchAll(pattern)].map((m) => m[0]!.toUpperCase());

    const keys = await resolveIssueKeysForWorkflowRun('aaa', 'test', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 10,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-1']);
  });

  it('reads commit messages on push scan when resolveKeyFromCommitMessage is false', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=pushh')) {
        return new Response(JSON.stringify([{ sha: 'pushh', commit: { message: 'KCM-7 deploy' } }]), {
          status: 200,
        });
      }
      if (url.endsWith('/commits/pushh/pulls')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; title?: string | null }) => {
      const text = [parts.title, parts.commitMessage].filter(Boolean).join('\n');
      return [...text.matchAll(pattern)].map((m) => m[0]!.toUpperCase());
    };

    const keys = await resolveIssueKeysForPush(
      'pushh',
      'test',
      ['KCM-7 deploy'],
      [{ sha: 'pushh', message: 'KCM-7 deploy' }],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: false,
        resolveKeysFromRecentCommits: 5,
        allowRecentCommitScan: true,
        skipMarker: null,
      }
    );

    expect(keys).toEqual(['KCM-7']);
  });

  it('defaults to scanning recent commits on push deploys', () => {
    expect(DEFAULT_SYNC_OPTIONS.resolveKeysFromRecentCommits).toBe(100);
  });

  it('reuses verified PR metadata so a later PR lookup failure cannot bypass skip markers', async () => {
    let pullCalls = 0;
    const skipPr = [
      {
        title: 'Feature',
        body: '[skip-jira]',
        html_url: 'https://github.com/org/repo/pull/8',
        merged_at: '2026-01-01T00:00:00Z',
        state: 'closed',
        head: { ref: 'feature', repo: { full_name: 'org/repo' } },
        base: { ref: 'dev' },
      },
    ];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=only')) {
        return new Response(JSON.stringify([{ sha: 'only', commit: { message: 'KCM-9 fix' } }]), {
          status: 200,
        });
      }
      if (url.endsWith('/commits/only/pulls')) {
        pullCalls += 1;
        if (pullCalls === 1) return new Response(JSON.stringify(skipPr), { status: 200 });
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; body?: string | null }) =>
      [...[parts.commitMessage, parts.body].filter(Boolean).join('\n').matchAll(pattern)].map(
        (m) => m[0]!.toUpperCase()
      );

    const keys = await resolveIssueKeysForWorkflowRun('only', 'staging', 'org/repo', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 5,
      allowRecentCommitScan: true,
      skipMarker: '[skip-jira]',
    });

    expect(keys).toEqual([]);
    expect(pullCalls).toBe(1);
  });

  it('does not re-resolve head after a successful scan when head was already listed', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=head')) {
        return new Response(
          JSON.stringify([{ sha: 'head', commit: { message: 'PROJ-9 fix [skip-jira]' } }]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/head/pulls')) {
        return new Response(
          JSON.stringify([
            {
              title: 'PROJ-9 feature',
              body: null,
              html_url: 'https://github.com/org/repo/pull/1',
              merged_at: '2026-01-01T00:00:00Z',
              state: 'closed',
              head: { ref: 'feature', repo: { full_name: 'org/repo' } },
              base: { ref: 'dev' },
            },
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith('/commits/head') && !url.includes('/pulls')) {
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /PROJ-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null; title?: string | null }) =>
      [...[parts.commitMessage, parts.title].filter(Boolean).join('\n').matchAll(pattern)].map(
        (m) => m[0]!.toUpperCase()
      );

    const keys = await resolveIssueKeysForPush(
      'head',
      'test',
      ['PROJ-9 fix [skip-jira]'],
      [{ sha: 'head', message: 'PROJ-9 fix [skip-jira]' }],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: true,
        resolveKeysFromRecentCommits: 10,
        allowRecentCommitScan: true,
        skipMarker: '[skip-jira]',
      }
    );

    expect(keys).toEqual([]);
  });

  it('skips keys when push list fails, payload has no commits, and head provenance fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=head')) {
        return new Response('error', { status: 500 });
      }
      if (url.endsWith('/commits/head/pulls')) {
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null }) =>
      [...(parts.commitMessage ?? '').matchAll(pattern)].map((m) => m[0]!.toUpperCase());

    const keys = await resolveIssueKeysForPush(
      'head',
      'test',
      [],
      [],
      'org/repo',
      extractAll,
      {
        resolveKeyFromCommitMessage: true,
        resolveKeysFromRecentCommits: 10,
        allowRecentCommitScan: true,
        skipMarker: null,
      }
    );

    expect(keys).toEqual([]);
  });
});
