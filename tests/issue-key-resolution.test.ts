import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveIssueKeysForWorkflowRun } from '../lib/actions/issueKeyResolution';
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

    const keys = await resolveIssueKeysForWorkflowRun('aaa', 'test', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 10,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-2', 'KCM-1']);
  });

  it('continues when listing pull requests for a commit returns 500', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/commits?sha=only')) {
        return new Response(JSON.stringify([{ sha: 'only', commit: { message: 'KCM-9 fix' } }]), {
          status: 200,
        });
      }
      if (url.endsWith('/commits/only/pulls')) {
        return new Response('error', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pattern = /KCM-\d+/gi;
    const extractAll = (parts: { commitMessage?: string | null }) =>
      [...(parts.commitMessage ?? '').matchAll(pattern)].map((m) => m[0]!.toUpperCase());

    const keys = await resolveIssueKeysForWorkflowRun('only', 'staging', extractAll, {
      resolveKeyFromCommitMessage: true,
      resolveKeysFromRecentCommits: 5,
      allowRecentCommitScan: true,
      skipMarker: null,
    });

    expect(keys).toEqual(['KCM-9']);
  });

  it('defaults to scanning recent commits on push deploys', () => {
    expect(DEFAULT_SYNC_OPTIONS.resolveKeysFromRecentCommits).toBe(100);
  });
});
