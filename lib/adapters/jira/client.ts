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

const CREDENTIAL_VARS = ['JIRA_BASE_URL', 'JIRA_USER_EMAIL', 'JIRA_API_TOKEN'] as const;

/** Credential variables that are unset or blank, e.g. because a secret does not reach the job. */
export function missingJiraCredentials(): string[] {
  return CREDENTIAL_VARS.filter((name) => !process.env[name]?.trim());
}

/** Site root for `*.atlassian.net` URLs (a pasted board or issue URL works); others lose trailing slashes. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.hostname.endsWith('.atlassian.net')) return url.origin;
  } catch {
    // Not a URL: requests fail and report it.
  }
  return trimmed;
}

/** Reads Jira credentials from environment; returns `null` if any secret is missing. */
export function readJiraConfigFromEnv(): JiraConfig | null {
  if (missingJiraCredentials().length > 0) return null;
  // Pasted secrets often end in a newline, which Jira rejects with 401.
  const value = (name: (typeof CREDENTIAL_VARS)[number]) => (process.env[name] ?? '').trim();
  return {
    baseUrl: normalizeBaseUrl(value('JIRA_BASE_URL')),
    email: value('JIRA_USER_EMAIL'),
    apiToken: value('JIRA_API_TOKEN'),
  };
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

/**
 * Why Jira answered 404 for an issue. Jira Cloud also says 404 when the login fails (the request
 * runs anonymously) or the account cannot browse the project, so this asks `/myself` which it is.
 */
export async function explainIssueNotFound(config: JiraConfig, issueKey: string): Promise<string> {
  let res: Response;
  try {
    res = await jiraFetch(config, '/rest/api/3/myself');
  } catch {
    return 'JIRA_BASE_URL could not be reached.';
  }
  if (res.status === 401 || res.status === 403) {
    return (
      `Jira rejected the login (HTTP ${res.status}): check JIRA_USER_EMAIL and JIRA_API_TOKEN. ` +
      'An API token with scopes needs JIRA_BASE_URL https://api.atlassian.com/ex/jira/<cloudId>.'
    );
  }
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
    return `JIRA_BASE_URL is not a Jira Cloud site (/rest/api/3/myself answered HTTP ${res.status}); use the site root, e.g. https://your-site.atlassian.net.`;
  }
  return `${issueKey} does not exist, or the Jira account cannot browse its project.`;
}

type JiraStatusRef = { id?: string; name?: string };

const untranslatedNamesCache = new WeakMap<JiraConfig, Promise<Map<string, string>>>();

/**
 * Untranslated status names by status id, loaded once per credentials object. Jira returns
 * status names in the calling account's language; rules use the untranslated names.
 */
function untranslatedStatusNames(config: JiraConfig): Promise<Map<string, string>> {
  let names = untranslatedNamesCache.get(config);
  if (!names) {
    names = loadUntranslatedStatusNames(config);
    untranslatedNamesCache.set(config, names);
  }
  return names;
}

async function loadUntranslatedStatusNames(config: JiraConfig): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  try {
    const res = await jiraFetch(config, '/rest/api/3/status');
    const data: unknown = res.ok ? await res.json() : [];
    for (const status of Array.isArray(data) ? (data as { id?: string; untranslatedName?: string }[]) : []) {
      if (status.id && status.untranslatedName) byId.set(status.id, status.untranslatedName);
    }
  } catch {
    // Without the list, statuses keep the names Jira returned.
  }
  return byId;
}

async function untranslatedStatusName(config: JiraConfig, status?: JiraStatusRef): Promise<string | null> {
  if (!status?.name) return null;
  return (status.id && (await untranslatedStatusNames(config)).get(status.id)) || status.name;
}

/** Current status of an issue (untranslated name), or `null` if missing. */
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
  const data = (await res.json()) as { fields?: { status?: JiraStatusRef } };
  return untranslatedStatusName(config, data.fields?.status);
}

/** Available transitions from the issue's current status; `to.name` is untranslated. */
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
  const data = (await res.json()) as { transitions?: (JiraTransitionOption & { to: JiraStatusRef })[] };
  return Promise.all(
    (data.transitions ?? []).map(async (transition) => ({
      ...transition,
      to: { ...transition.to, name: (await untranslatedStatusName(config, transition.to)) ?? transition.to.name },
    }))
  );
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

/**
 * Adds a remote (web) link, e.g. the GitHub PR, to the issue. Uses the URL as `globalId`, so
 * Jira updates an existing link instead of creating a duplicate on repeated runs.
 */
export async function addIssueRemoteLink(
  config: JiraConfig,
  issueKey: string,
  url: string,
  title: string
): Promise<void> {
  const res = await jiraFetch(config, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`, {
    method: 'POST',
    body: JSON.stringify({
      // Jira caps globalId at 255 characters.
      ...(url.length <= 255 ? { globalId: url } : {}),
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

/** Status names in a Jira project's workflows, untranslated and as the account sees them (preflight). */
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
  const data = (await res.json()) as {
    name?: string;
    statuses?: { name?: string; untranslatedName?: string }[];
  }[];
  const names = new Set<string>();
  for (const item of data) {
    for (const st of item.statuses ?? []) {
      if (st.name) names.add(st.name);
      if (st.untranslatedName) names.add(st.untranslatedName);
    }
  }
  return names;
}
