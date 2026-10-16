/**
 * Jira Cloud REST client (Basic auth, retries on 429, ADF comments).
 *
 * Credentials from `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.
 *
 * @module adapters/jira/client
 */
import { pickTransition, type JiraTransitionOption } from '../../utils/pickTransition';

/** Atlassian Cloud credentials (never log or persist). */
export type JiraConfig = {
  baseUrl: string;
  email: string;
  apiToken: string;
};

/** Issue key absent or deleted in Jira (HTTP 404). */
export class JiraIssueNotFoundError extends Error {
  readonly issueKey: string;
  readonly status = 404;

  constructor(issueKey: string) {
    super(`Jira issue not found: ${issueKey}`);
    this.name = 'JiraIssueNotFoundError';
    this.issueKey = issueKey;
  }
}

/** Non-404 Jira REST failure (includes HTTP status). */
export class JiraApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'JiraApiError';
    this.status = status;
  }
}

/** Reads Jira credentials from environment; returns `null` if any secret is missing. */
export function readJiraConfigFromEnv(): JiraConfig | null {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  const email = process.env.JIRA_USER_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl, email, apiToken };
}

function authHeader(config: JiraConfig): string {
  const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return `Basic ${encoded}`;
}

const MAX_JIRA_RETRIES = 3;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function jiraFetch(config: JiraConfig, path: string, init?: RequestInit): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= MAX_JIRA_RETRIES; attempt++) {
    const res = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(config),
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    lastRes = res;
    if (res.status !== 429 || attempt === MAX_JIRA_RETRIES) {
      return res;
    }
    const retryAfter = res.headers.get('Retry-After');
    const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 2000 * (attempt + 1);
    await sleep(Number.isFinite(waitMs) ? waitMs : 2000);
  }
  return lastRes!;
}

function throwForIssueResponse(res: Response, issueKey: string, action: string): never {
  if (res.status === 404) {
    throw new JiraIssueNotFoundError(issueKey);
  }
  throw new JiraApiError(res.status, `Jira ${action} failed (${res.status}) for ${issueKey}`);
}

/** Smoke test for Actions secrets (GET /rest/api/3/myself). */
export async function verifyJiraConnection(config: JiraConfig): Promise<{ accountId: string }> {
  const res = await jiraFetch(config, '/rest/api/3/myself');
  if (!res.ok) {
    const text = await res.text();
    throw new JiraApiError(
      res.status,
      `Jira auth check failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as { accountId?: string };
  if (!data.accountId) {
    throw new JiraApiError(500, 'Jira auth check returned no accountId');
  }
  return { accountId: data.accountId };
}

/** Current workflow column name for an issue, or `null` if missing. */
export async function getIssueStatusName(
  config: JiraConfig,
  issueKey: string
): Promise<string | null> {
  const res = await jiraFetch(
    config,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`
  );
  if (!res.ok) {
    throwForIssueResponse(res, issueKey, 'get issue');
  }
  const data = (await res.json()) as { fields?: { status?: { name?: string } } };
  return data.fields?.status?.name ?? null;
}

/** Available transitions from the issue's current column. */
export async function listIssueTransitions(
  config: JiraConfig,
  issueKey: string
): Promise<JiraTransitionOption[]> {
  const res = await jiraFetch(
    config,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
  );
  if (!res.ok) {
    throwForIssueResponse(res, issueKey, 'list transitions');
  }
  const data = (await res.json()) as { transitions?: JiraTransitionOption[] };
  return data.transitions ?? [];
}

async function applyTransition(
  config: JiraConfig,
  issueKey: string,
  transitionId: string
): Promise<void> {
  const res = await jiraFetch(
    config,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) {
      throw new JiraIssueNotFoundError(issueKey);
    }
    throw new JiraApiError(
      res.status,
      `Jira transition failed (${res.status}) for ${issueKey}: ${text.slice(0, 200)}`
    );
  }
}

function plainTextAdf(text: string): { type: string; version: number; content: unknown[] } {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/** Adds a plain-text comment (ADF) to the issue. */
export async function addIssueComment(
  config: JiraConfig,
  issueKey: string,
  text: string
): Promise<void> {
  const res = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ body: plainTextAdf(text) }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) {
      throw new JiraIssueNotFoundError(issueKey);
    }
    throw new JiraApiError(
      res.status,
      `Jira comment failed (${res.status}) for ${issueKey}: ${body.slice(0, 200)}`
    );
  }
}

/** Outcome of {@link transitionIssueToStatus} (success, already there, or no path). */
export type TransitionResult =
  | { ok: true; from: string; to: string; transitionName: string }
  | { ok: true; skipped: true; reason: 'already'; status: string }
  | { ok: false; reason: 'no_transition'; from: string; target: string };

/**
 * Moves an issue to `targetStatus` when a transition exists.
 *
 * @param preferredTransitionNames - Optional Jira transition names to try first
 */
export async function transitionIssueToStatus(
  config: JiraConfig,
  issueKey: string,
  targetStatus: string,
  preferredTransitionNames: readonly string[] = []
): Promise<TransitionResult> {
  const current = await getIssueStatusName(config, issueKey);
  if (!current) throw new JiraApiError(500, `Could not read status for ${issueKey}`);
  if (current === targetStatus) {
    return { ok: true, skipped: true, reason: 'already', status: current };
  }

  const transitions = await listIssueTransitions(config, issueKey);
  const chosen = pickTransition(transitions, targetStatus, preferredTransitionNames);
  if (!chosen) {
    return { ok: false, reason: 'no_transition', from: current, target: targetStatus };
  }

  await applyTransition(config, issueKey, chosen.id);
  return {
    ok: true,
    from: current,
    to: chosen.to.name,
    transitionName: chosen.name,
  };
}

/** Adds a remote link (e.g. GitHub PR) to the issue development panel. */
export async function addIssueRemoteLink(
  config: JiraConfig,
  issueKey: string,
  url: string,
  title: string
): Promise<void> {
  const res = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`, {
    method: 'POST',
    body: JSON.stringify({
      object: { url, title },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) throw new JiraIssueNotFoundError(issueKey);
    throw new JiraApiError(
      res.status,
      `Jira remote link failed (${res.status}) for ${issueKey}: ${body.slice(0, 200)}`
    );
  }
}

/** Updates writable issue fields (custom field ids as keys). */
export async function updateIssueFields(
  config: JiraConfig,
  issueKey: string,
  fields: Record<string, string>
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const res = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) throw new JiraIssueNotFoundError(issueKey);
    throw new JiraApiError(
      res.status,
      `Jira field update failed (${res.status}) for ${issueKey}: ${body.slice(0, 200)}`
    );
  }
}

/** Status names available in a Jira project workflow (for config preflight). */
export async function listProjectStatusNames(
  config: JiraConfig,
  projectKey: string
): Promise<Set<string>> {
  const res = await jiraFetch(
    config,
    `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new JiraApiError(res.status, `Jira project statuses failed: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { name?: string; statuses?: { name?: string }[] }[];
  const names = new Set<string>();
  for (const item of data) {
    for (const st of item.statuses ?? []) {
      if (st.name) names.add(st.name);
    }
  }
  return names;
}
