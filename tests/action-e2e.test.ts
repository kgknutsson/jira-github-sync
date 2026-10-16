import { execFile, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/** End-to-end runs of the bundled action (dist/index.mjs) against a fake Jira server. */
const ROOT = process.cwd();
const STATUSES = ['In Progress', 'In Review', 'Done', 'Deployed (Dev)', 'Deployed (Test)'];

type Call = { method: string; url: string; body?: unknown };
const calls: Call[] = [];
const issueStatus: Record<string, string> = {};
let server: Server;
let jiraUrl: string;

function fakeJira(): Server {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : undefined });
      const json = (value: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/rest/api/3/myself') return json({ accountId: 'bot-account' });
      if (req.url === '/rest/api/3/project/PROJ/statuses') {
        return json([{ name: 'Task', statuses: STATUSES.map((name) => ({ name })) }]);
      }
      const match = req.url!.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/\w+)?/);
      const key = match?.[1];
      if (!key || !(key in issueStatus)) {
        res.writeHead(404);
        return res.end('{}');
      }
      const sub = match?.[2] ?? '';
      if (req.method === 'GET' && sub === '') return json({ fields: { status: { name: issueStatus[key] } } });
      if (req.method === 'GET' && sub === '/transitions') {
        return json({ transitions: [{ id: '11', name: 'Start review', to: { name: 'In Review' } }] });
      }
      if (req.method === 'POST' && sub === '/transitions') {
        issueStatus[key] = 'In Review';
        res.writeHead(204);
        return res.end();
      }
      return json({ id: '1' });
    });
  });
}

async function runAction(env: Record<string, string>, payload: unknown = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-sync-action-'));
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(payload));
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: ROOT,
    GITHUB_REPOSITORY: 'org/repo',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: 'org/repo/templates/jira-sync.workflow.yml@refs/heads/main',
    GITHUB_JOB: 'jira-sync',
    'INPUT_CONFIG-FILE': 'templates/jira-sync.config.yml',
    'INPUT_JIRA-BASE-URL': jiraUrl,
    'INPUT_JIRA-USER-EMAIL': 'bot@example.com',
    'INPUT_JIRA-API-TOKEN': 'token',
    ...env,
  };
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['dist/index.mjs'], {
      cwd: ROOT,
      env: childEnv,
    });
    return { code: 0, output: stdout + stderr };
  } catch (err) {
    const failed = err as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

const openedPr = {
  action: 'opened',
  pull_request: {
    title: 'PROJ-5 Add login',
    body: null,
    html_url: 'https://github.com/org/repo/pull/5',
    merged: false,
    draft: false,
    state: 'open',
    head: { ref: 'PROJ-5_login', repo: { full_name: 'org/repo' } },
    base: { ref: 'dev' },
    labels: [],
    user: { login: 'octocat' },
  },
};

beforeAll(async () => {
  execSync('node build.mjs', { cwd: ROOT, stdio: 'pipe' });
  server = fakeJira();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  jiraUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  calls.length = 0;
  issueStatus['PROJ-5'] = 'In Progress';
});

describe('action (dist/index.mjs)', () => {
  it('moves the issue for a pull request event, with no warnings', async () => {
    const { code, output } = await runAction({ GITHUB_EVENT_NAME: 'pull_request' }, openedPr);
    expect(code, output).toBe(0);
    expect(output).not.toContain('::warning');
    expect(output).toContain('Rule: PR ready → In Review');
    expect(calls).toContainEqual({
      method: 'POST',
      url: '/rest/api/3/issue/PROJ-5/transitions',
      body: { transition: { id: '11' } },
    });
    expect(calls.some((c) => c.url === '/rest/api/3/issue/PROJ-5/remotelink')).toBe(true);
  });

  it('validate-only checks Jira status names and changes nothing', async () => {
    const { code, output } = await runAction(
      { GITHUB_EVENT_NAME: 'pull_request', 'INPUT_VALIDATE-ONLY': 'true' },
      openedPr
    );
    expect(code, output).toBe(0);
    expect(output).toContain('Jira status names OK');
    expect(calls.map((c) => c.url)).toEqual(['/rest/api/3/myself', '/rest/api/3/project/PROJ/statuses']);
  });

  it('warns, naming the empty secret, when an issue cannot be updated without credentials', async () => {
    const { code, output } = await runAction(
      { GITHUB_EVENT_NAME: 'pull_request', 'INPUT_JIRA-API-TOKEN': '' },
      openedPr
    );
    expect(code, output).toBe(0);
    expect(output).toContain('::warning::PROJ-5 not updated: Jira credentials missing (JIRA_API_TOKEN).');
    expect(calls).toEqual([]);
  });

  it('does not warn about credentials when the event has no issue key', async () => {
    const keyless = {
      ...openedPr,
      pull_request: { ...openedPr.pull_request, title: 'Bump deps', head: { ...openedPr.pull_request.head, ref: 'deps' } },
    };
    const { code, output } = await runAction(
      { GITHUB_EVENT_NAME: 'pull_request', 'INPUT_JIRA-API-TOKEN': '' },
      keyless
    );
    expect(code, output).toBe(0);
    expect(output).toContain('No PROJ issue key for event');
    expect(output).not.toContain('::warning');
  });

  it('validate-only warns when credentials are missing', async () => {
    const { code, output } = await runAction(
      {
        GITHUB_EVENT_NAME: 'pull_request',
        'INPUT_VALIDATE-ONLY': 'true',
        'INPUT_JIRA-BASE-URL': '',
        'INPUT_JIRA-USER-EMAIL': '',
      },
      openedPr
    );
    expect(code, output).toBe(0);
    expect(output).toContain('::warning::Jira status check skipped: credentials missing (JIRA_BASE_URL, JIRA_USER_EMAIL)');
    expect(calls).toEqual([]);
  });

  it('fails with a line annotation for an invalid rules file', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'jira-sync-workspace-'));
    mkdirSync(join(workspace, '.github'));
    writeFileSync(
      join(workspace, '.github', 'jira-sync.config.yml'),
      'projectKey: PROJ\nrules:\n  - name: Merged\n    when: pull_request\n    trasitionTo: Done\n'
    );
    const { code, output } = await runAction({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_WORKSPACE: workspace,
      'INPUT_CONFIG-FILE': '',
    });
    expect(code).toBe(1);
    expect(output).toContain('::error file=.github/jira-sync.config.yml,line=5,col=5::Unknown key "trasitionTo"');
  });
});
