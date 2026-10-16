// lib/config/jiraConfigLabels.ts
function jiraStatusNamesFromConfig(built) {
  const names = /* @__PURE__ */ new Set();
  for (const status of Object.values(built.deploy.environmentToJiraStatus)) {
    names.add(status);
  }
  for (const rule of built.rules) {
    if (rule.when.jiraStatusIs) names.add(rule.when.jiraStatusIs);
    if (rule.when.jiraStatusIsNot) names.add(rule.when.jiraStatusIsNot);
    if (rule.then.kind === "transition") names.add(rule.then.status);
  }
  return [...names].sort();
}

// lib/utils/pickTransition.ts
function pickTransition(transitions, targetStatus, preferredTransitionNames = []) {
  for (const pref of preferredTransitionNames) {
    const byName = transitions.find((t) => t.name === pref && t.to.name === targetStatus);
    if (byName) return byName;
  }
  return transitions.find((t) => t.to.name === targetStatus) ?? null;
}

// lib/adapters/jira/client.ts
var JiraIssueNotFoundError = class extends Error {
  issueKey;
  status = 404;
  constructor(issueKey) {
    super(`Jira issue not found: ${issueKey}`);
    this.name = "JiraIssueNotFoundError";
    this.issueKey = issueKey;
  }
};
var JiraApiError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.name = "JiraApiError";
    this.status = status;
  }
};
function readJiraConfigFromEnv() {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_USER_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl, email, apiToken };
}
function authHeader(config2) {
  const encoded = Buffer.from(`${config2.email}:${config2.apiToken}`).toString("base64");
  return `Basic ${encoded}`;
}
var MAX_JIRA_RETRIES = 3;
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function jiraFetch(config2, path, init) {
  let lastRes = null;
  for (let attempt = 0; attempt <= MAX_JIRA_RETRIES; attempt++) {
    const res = await fetch(`${config2.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: authHeader(config2),
        "Content-Type": "application/json",
        ...init?.headers
      }
    });
    lastRes = res;
    if (res.status !== 429 || attempt === MAX_JIRA_RETRIES) {
      return res;
    }
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1e3 : 2e3 * (attempt + 1);
    await sleep(Number.isFinite(waitMs) ? waitMs : 2e3);
  }
  return lastRes;
}
function throwForIssueResponse(res, issueKey, action) {
  if (res.status === 404) {
    throw new JiraIssueNotFoundError(issueKey);
  }
  throw new JiraApiError(res.status, `Jira ${action} failed (${res.status}) for ${issueKey}`);
}
async function verifyJiraConnection(config2) {
  const res = await jiraFetch(config2, "/rest/api/3/myself");
  if (!res.ok) {
    const text = await res.text();
    throw new JiraApiError(
      res.status,
      `Jira auth check failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const data = await res.json();
  if (!data.accountId) {
    throw new JiraApiError(500, "Jira auth check returned no accountId");
  }
  return { accountId: data.accountId };
}
async function getIssueStatusName(config2, issueKey) {
  const res = await jiraFetch(
    config2,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status`
  );
  if (!res.ok) {
    throwForIssueResponse(res, issueKey, "get issue");
  }
  const data = await res.json();
  return data.fields?.status?.name ?? null;
}
async function listIssueTransitions(config2, issueKey) {
  const res = await jiraFetch(
    config2,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
  );
  if (!res.ok) {
    throwForIssueResponse(res, issueKey, "list transitions");
  }
  const data = await res.json();
  return data.transitions ?? [];
}
async function applyTransition(config2, issueKey, transitionId) {
  const res = await jiraFetch(
    config2,
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: transitionId } })
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
function plainTextAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  };
}
async function addIssueComment(config2, issueKey, text) {
  const res = await jiraFetch(config2, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: plainTextAdf(text) })
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
async function transitionIssueToStatus(config2, issueKey, targetStatus, preferredTransitionNames = []) {
  const current = await getIssueStatusName(config2, issueKey);
  if (!current) throw new JiraApiError(500, `Could not read status for ${issueKey}`);
  if (current === targetStatus) {
    return { ok: true, skipped: true, reason: "already", status: current };
  }
  const transitions = await listIssueTransitions(config2, issueKey);
  const chosen = pickTransition(transitions, targetStatus, preferredTransitionNames);
  if (!chosen) {
    return { ok: false, reason: "no_transition", from: current, target: targetStatus };
  }
  await applyTransition(config2, issueKey, chosen.id);
  return {
    ok: true,
    from: current,
    to: chosen.to.name,
    transitionName: chosen.name
  };
}
async function addIssueRemoteLink(config2, issueKey, url, title) {
  const res = await jiraFetch(config2, `/rest/api/3/issue/${encodeURIComponent(issueKey)}/remotelink`, {
    method: "POST",
    body: JSON.stringify({
      // Jira caps globalId at 255 characters.
      ...url.length <= 255 ? { globalId: url } : {},
      object: { url, title }
    })
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
async function updateIssueFields(config2, issueKey, fields) {
  if (Object.keys(fields).length === 0) return;
  const res = await jiraFetch(config2, `/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: "PUT",
    body: JSON.stringify({ fields })
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
async function listProjectStatusNames(config2, projectKey) {
  const res = await jiraFetch(
    config2,
    `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new JiraApiError(res.status, `Jira project statuses failed: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const names = /* @__PURE__ */ new Set();
  for (const item of data) {
    for (const st of item.statuses ?? []) {
      if (st.name) names.add(st.name);
    }
  }
  return names;
}

// lib/adapters/jira/preflightConfig.ts
async function validateJiraStringsAgainstProject(config2, built) {
  const issues = [];
  let available;
  try {
    available = await listProjectStatusNames(config2, built.projectKey);
  } catch (err) {
    issues.push({
      level: "error",
      message: `Could not load Jira statuses for ${built.projectKey}: ${String(err)}`
    });
    return issues;
  }
  for (const name of jiraStatusNamesFromConfig(built)) {
    if (!available.has(name)) {
      issues.push({
        level: "error",
        message: `Jira project ${built.projectKey} has no status named "${name}" (check settings strings)`
      });
    }
  }
  if (available.size === 0) {
    issues.push({ level: "warning", message: "Jira returned no statuses for project" });
  }
  return issues;
}

// lib/config/syncOptions.ts
var DEFAULT_SYNC_OPTIONS = {
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  failOnJiraError: true,
  skipMarker: "[skip-jira]",
  noTransitionMessageId: "noTransition"
};

// lib/config/catalog.ts
var EVENTS = {
  pull_request: "Pull request opened, updated, marked ready, converted to draft, closed, \u2026",
  pull_request_review: "Review submitted, edited or dismissed on a pull request.",
  workflow_run: "A GitHub Actions workflow finished (CI, deploy, \u2026). Match it with the `workflow` condition.",
  check_suite: "Check suite completed. Third-party CI apps only: GitHub never triggers workflows for checks created by GitHub Actions.",
  check_run: "Single check run completed. Third-party CI apps only, like check_suite.",
  issue_comment: "Comment created, edited or deleted on an issue or pull request.",
  push: "Commits pushed to a branch. Issue keys come from the commit messages and branch.",
  release: "Release published, created, edited, \u2026",
  merge_group: "Merge queue checks requested, or merge group destroyed.",
  deployment_status: "Deployment status reported for a GitHub Environment."
};
var EVENT_NAMES = Object.keys(EVENTS);
var EVENT_ACTIONS = {
  pull_request: [
    "assigned",
    "auto_merge_disabled",
    "auto_merge_enabled",
    "closed",
    "converted_to_draft",
    "demilestoned",
    "dequeued",
    "edited",
    "enqueued",
    "labeled",
    "locked",
    "milestoned",
    "opened",
    "ready_for_review",
    "reopened",
    "review_request_removed",
    "review_requested",
    "synchronize",
    "unassigned",
    "unlabeled",
    "unlocked"
  ],
  pull_request_review: ["submitted", "edited", "dismissed"],
  check_suite: ["completed"],
  check_run: ["completed"],
  issue_comment: ["created", "edited", "deleted"],
  release: ["published", "unpublished", "created", "edited", "deleted", "prereleased", "released"],
  merge_group: ["checks_requested", "destroyed"],
  deployment_status: ["created"]
};
var CONCLUSIONS = [
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "neutral",
  "skipped",
  "stale",
  "startup_failure"
];
var PR_EVENTS = ["pull_request", "pull_request_review"];
var CONDITIONS = {
  action: {
    description: "Webhook action, e.g. opened, closed, submitted, published.",
    events: Object.keys(EVENT_ACTIONS),
    type: "string",
    values: "action"
  },
  reviewState: {
    description: "Review outcome.",
    events: ["pull_request_review"],
    type: "string",
    values: ["approved", "changes_requested", "commented", "dismissed"]
  },
  workflow: {
    description: "Workflow `name:` of the finished run. Also list it under on.workflow_run.workflows in the workflow file.",
    events: ["workflow_run"],
    type: "string"
  },
  runEvent: {
    description: "What triggered the run: pull_request, push, workflow_dispatch, schedule, \u2026",
    events: ["workflow_run"],
    type: "string"
  },
  conclusion: {
    description: "Run or check result.",
    events: ["workflow_run", "check_suite", "check_run"],
    type: "string",
    values: CONCLUSIONS
  },
  prState: {
    description: "Pull request state.",
    events: PR_EVENTS,
    type: "string",
    values: ["open", "closed"]
  },
  merged: {
    description: "true for merged pull requests (use with action: closed).",
    events: ["pull_request"],
    type: "boolean"
  },
  draft: {
    description: "false for pull requests ready for review, true for drafts.",
    events: ["pull_request"],
    type: "boolean"
  },
  baseRef: {
    description: "Target branch, without refs/heads/.",
    events: [...PR_EVENTS, "issue_comment", "merge_group"],
    type: "string"
  },
  headRef: {
    description: "Source branch (push: the pushed branch), without refs/heads/.",
    events: [...PR_EVENTS, "issue_comment", "merge_group", "push"],
    type: "string"
  },
  label: {
    description: "The pull request has at least one of these labels.",
    events: [...PR_EVENTS, "issue_comment"],
    type: "string"
  },
  notLabel: {
    description: "The pull request has none of these labels (e.g. an opt-out label).",
    events: [...PR_EVENTS, "issue_comment"],
    type: "string"
  },
  author: {
    description: "GitHub login of the pull request author.",
    events: PR_EVENTS,
    type: "string"
  },
  checkName: {
    description: "Check suite app name or check run name (third-party CI).",
    events: ["check_suite", "check_run"],
    type: "string"
  },
  deploymentEnvironment: {
    description: "GitHub Environment name.",
    events: ["deployment_status"],
    type: "string"
  },
  deploymentState: {
    description: "Deployment status.",
    events: ["deployment_status"],
    type: "string",
    values: ["success", "failure", "error", "pending", "inactive", "in_progress", "queued"]
  },
  releaseTag: {
    description: "Release tag name, e.g. v1.2.0 (quote numbers).",
    events: ["release"],
    type: "string"
  }
};
var PLACEHOLDERS = {
  issueKey: "Jira issue key, e.g. PROJ-123",
  url: "Main link: PR, workflow run, release, comment, or commit/checks page",
  prUrl: "Pull request URL (pull_request, pull_request_review, PR comments)",
  baseRef: "Target branch",
  headRef: "Source or pushed branch",
  currentStatus: "Jira status when the rule matched",
  targetStatus: "Status a transition or deploy step moves to",
  status: "Target status in transition/deploy comments; current status in comment rules",
  env: "Deploy environment (deploy steps) or GitHub Environment (deployment_status)",
  workflowName: "Workflow name (workflow_run)",
  runEvent: "What triggered the workflow run",
  conclusion: "Run or check conclusion",
  checkName: "Check name",
  author: "Pull request author login",
  labels: "Comma-separated pull request labels",
  releaseTag: "Release tag",
  releaseName: "Release name",
  ref: "Pushed ref (push)",
  deploymentState: "Deployment state (deployment_status)"
};

// lib/config/validateConfig.ts
var STEP_MESSAGE_FIELDS = ["onNoTransition", "commentAfterSuccess", "commentWhenSkipped"];
function messageReferences(step) {
  if (step.kind === "comment") return [{ field: "comment", key: step.messageKey }];
  return STEP_MESSAGE_FIELDS.flatMap((field) => {
    const key = step[field];
    return key ? [{ field, key }] : [];
  });
}
function unknownPlaceholders(template) {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).filter((name) => !Object.hasOwn(PLACEHOLDERS, name));
}
function validateBuiltSyncConfig(built) {
  const issues = [];
  if (!built.projectKey.trim()) {
    issues.push({ level: "error", message: "projectKey is empty", path: ["projectKey"] });
  }
  if (built.rules.length === 0) {
    issues.push({ level: "error", message: "No rules defined", path: ["rules"] });
  }
  const namesById = /* @__PURE__ */ new Map();
  built.rules.forEach((rule, index) => {
    const other = namesById.get(rule.id);
    if (other !== void 0) {
      issues.push({
        level: "error",
        message: `Rules "${other}" and "${rule.name}" get the same id (${rule.id}); give them different names`,
        path: ["rules", index, "name"]
      });
    }
    namesById.set(rule.id, rule.name);
    for (const { field, key } of messageReferences(rule.then)) {
      if (!Object.hasOwn(built.messages, key)) {
        issues.push({
          level: "error",
          message: `Rule "${rule.name}" references unknown message "${key}"`,
          path: ["rules", index, field]
        });
      }
    }
    for (const [fieldId, template] of Object.entries(rule.then.extras?.fields ?? {})) {
      for (const name of unknownPlaceholders(template)) {
        issues.push({
          level: "warning",
          message: `Rule "${rule.name}" field ${fieldId} uses unknown placeholder {${name}}`,
          path: ["rules", index, "fields", fieldId]
        });
      }
    }
  });
  if (built.deploy.jobNameRegex !== void 0) {
    try {
      new RegExp(built.deploy.jobNameRegex);
    } catch {
      issues.push({
        level: "error",
        message: "deploy.jobNameRegex is not a valid regular expression",
        path: ["deploy", "jobNameRegex"]
      });
    }
  }
  for (const [branch, env] of Object.entries(built.deploy.branchToEnvironment)) {
    if (!Object.hasOwn(built.deploy.environmentToJiraStatus, env)) {
      issues.push({
        level: "warning",
        message: `deploy.branchToEnvironment maps "${branch}" to "${env}", which environmentToJiraStatus does not list`,
        path: ["deploy", "branchToEnvironment", branch]
      });
    }
  }
  const defaultNoTransition = { ...DEFAULT_SYNC_OPTIONS, ...built.options }.noTransitionMessageId;
  if (defaultNoTransition != null && !Object.hasOwn(built.messages, defaultNoTransition)) {
    issues.push({
      level: "error",
      message: `options.noTransitionMessageId references unknown message "${defaultNoTransition}" (add it to messages or set it to null)`,
      path: ["options", "noTransitionMessageId"]
    });
  }
  const referenced = new Set(defaultNoTransition ? [defaultNoTransition] : []);
  for (const rule of built.rules) {
    for (const { key } of messageReferences(rule.then)) referenced.add(key);
  }
  for (const [key, template] of Object.entries(built.messages)) {
    if (!referenced.has(key)) {
      issues.push({
        level: "warning",
        message: `Message "${key}" is not used by any rule`,
        path: ["messages", key]
      });
    }
    for (const name of unknownPlaceholders(template)) {
      issues.push({
        level: "warning",
        message: `Message "${key}" uses unknown placeholder {${name}}`,
        path: ["messages", key]
      });
    }
  }
  return issues;
}
function assertValidConfig(built) {
  const issues = validateBuiltSyncConfig(built).filter((i) => i.level === "error");
  if (issues.length > 0) {
    throw new Error(`Invalid jira-sync config:
${issues.map((i) => `- ${i.message}`).join("\n")}`);
  }
}

// lib/config/compileConfig.ts
function compileConfig(built, validate = true) {
  if (validate) assertValidConfig(built);
  const options = { ...DEFAULT_SYNC_OPTIONS, ...built.options };
  const projectKey = built.projectKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const issueKeyPattern = new RegExp(
    String.raw`(?<![A-Za-z0-9])${projectKey}-\d+(?![0-9])`,
    "gi"
  );
  return {
    built: { ...built, options },
    projectKey: built.projectKey,
    options,
    issueKeyPattern,
    deployJobPattern: built.deploy.jobNameRegex ? new RegExp(built.deploy.jobNameRegex) : null,
    deployEnvToStatus: built.deploy.environmentToJiraStatus,
    branchToDeployEnv: built.deploy.branchToEnvironment,
    messageTemplate(key) {
      const t = built.messages[key];
      if (!t) throw new Error(`Unknown message key: ${key}`);
      return t;
    }
  };
}

// lib/engine/eventContext.ts
import { readFileSync } from "node:fs";

// lib/adapters/github/parseEvent.ts
function stripHeadsPrefix(ref) {
  return ref.replace(/^refs\/heads\//, "");
}
function pullRequestFromPayload(pr) {
  const merged = pr.merged ?? (pr.merged_at != null && pr.merged_at !== "");
  return {
    title: pr.title,
    headRef: pr.head.ref,
    body: pr.body,
    htmlUrl: pr.html_url,
    merged,
    draft: pr.draft,
    state: pr.state === "closed" ? "closed" : "open",
    baseRef: pr.base.ref,
    headRepoFullName: pr.head.repo?.full_name ?? "",
    labels: (pr.labels ?? []).map((l) => l.name),
    authorLogin: pr.user?.login ?? ""
  };
}
function parseGitHubEvent(eventName, payload) {
  if (eventName === "pull_request") {
    const p = payload;
    if (!p.action || !p.pull_request) return null;
    return {
      kind: "pull_request",
      action: p.action,
      pr: pullRequestFromPayload(p.pull_request)
    };
  }
  if (eventName === "pull_request_review") {
    const p = payload;
    if (!p.action || !p.review?.state || !p.pull_request) return null;
    return {
      kind: "pull_request_review",
      action: p.action,
      reviewState: p.review.state,
      pr: pullRequestFromPayload(p.pull_request)
    };
  }
  if (eventName === "workflow_run") {
    const p = payload;
    const run = p.workflow_run;
    if (!run) return null;
    return {
      kind: "workflow_run",
      workflowName: run.name,
      runEvent: run.event ?? "unknown",
      conclusion: run.conclusion ?? null,
      headSha: run.head_sha,
      headBranch: run.head_branch ?? "",
      runUrl: run.html_url,
      runId: run.id
    };
  }
  if (eventName === "check_suite") {
    const p = payload;
    const suite = p.check_suite;
    if (!p.action || !suite?.head_sha) return null;
    return {
      kind: "check_suite",
      action: p.action,
      conclusion: suite.conclusion ?? null,
      checkName: suite.app?.name ?? "check_suite",
      headSha: suite.head_sha,
      headBranch: suite.head_branch ?? ""
    };
  }
  if (eventName === "check_run") {
    const p = payload;
    const run = p.check_run;
    if (!p.action || !run?.head_sha) return null;
    return {
      kind: "check_run",
      action: p.action,
      conclusion: run.conclusion ?? null,
      checkName: run.name ?? "check_run",
      headSha: run.head_sha,
      headBranch: run.check_suite?.head_branch ?? "",
      checkUrl: run.html_url ?? ""
    };
  }
  if (eventName === "issue_comment") {
    const p = payload;
    if (!p.action || !p.comment?.body) return null;
    const issueNumber = p.issue?.number;
    const onPullRequest = p.issue?.pull_request != null && typeof issueNumber === "number";
    return {
      kind: "issue_comment",
      action: p.action,
      body: p.comment.body,
      pullRequestNumber: onPullRequest ? issueNumber : null,
      commentUrl: p.comment.html_url ?? ""
    };
  }
  if (eventName === "push") {
    const p = payload;
    if (!p.ref || !p.after) return null;
    return {
      kind: "push",
      ref: p.ref,
      headSha: p.after,
      commitMessages: (p.commits ?? []).map((c) => c.message ?? "")
    };
  }
  if (eventName === "release") {
    const p = payload;
    if (!p.action || !p.release?.tag_name) return null;
    return {
      kind: "release",
      action: p.action,
      tagName: p.release.tag_name,
      releaseName: p.release.name || p.release.tag_name,
      releaseUrl: p.release.html_url ?? ""
    };
  }
  if (eventName === "merge_group") {
    const p = payload;
    const mg = p.merge_group;
    if (!p.action || !mg?.head_sha) return null;
    return {
      kind: "merge_group",
      action: p.action,
      headRef: stripHeadsPrefix(mg.head_ref ?? ""),
      headSha: mg.head_sha,
      baseRef: stripHeadsPrefix(mg.base_ref ?? ""),
      commitMessage: mg.head_commit?.message ?? ""
    };
  }
  if (eventName === "deployment_status") {
    const p = payload;
    const dep = p.deployment;
    const st = p.deployment_status;
    if (!p.action || !dep?.environment || !st?.state) return null;
    return {
      kind: "deployment_status",
      action: p.action,
      environment: dep.environment,
      state: st.state,
      deploymentUrl: st.environment_url ?? "",
      headSha: dep.sha ?? "",
      ref: dep.ref ?? ""
    };
  }
  return null;
}

// lib/engine/eventContext.ts
function contextFromParsed(parsed, repository) {
  switch (parsed.kind) {
    case "pull_request":
      return {
        event: "pull_request",
        action: parsed.action,
        pr: parsed.pr,
        repository,
        url: parsed.pr.htmlUrl
      };
    case "pull_request_review":
      return {
        event: "pull_request_review",
        action: parsed.action,
        reviewState: parsed.reviewState,
        pr: parsed.pr,
        repository,
        url: parsed.pr.htmlUrl
      };
    case "workflow_run":
      return {
        event: "workflow_run",
        workflowName: parsed.workflowName,
        runEvent: parsed.runEvent,
        conclusion: parsed.conclusion,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        runUrl: parsed.runUrl,
        runId: parsed.runId
      };
    case "check_suite":
      return {
        event: "check_suite",
        action: parsed.action,
        conclusion: parsed.conclusion,
        checkName: parsed.checkName,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        repository
      };
    case "check_run":
      return {
        event: "check_run",
        action: parsed.action,
        conclusion: parsed.conclusion,
        checkName: parsed.checkName,
        headSha: parsed.headSha,
        headBranch: parsed.headBranch,
        checkUrl: parsed.checkUrl,
        repository
      };
    case "issue_comment":
      return {
        event: "issue_comment",
        action: parsed.action,
        body: parsed.body,
        pullRequestNumber: parsed.pullRequestNumber,
        pr: null,
        repository,
        url: parsed.commentUrl
      };
    case "push":
      return {
        event: "push",
        ref: parsed.ref,
        headSha: parsed.headSha,
        commitMessages: parsed.commitMessages,
        repository
      };
    case "release":
      return {
        event: "release",
        action: parsed.action,
        tagName: parsed.tagName,
        releaseName: parsed.releaseName,
        releaseUrl: parsed.releaseUrl,
        repository
      };
    case "merge_group":
      return {
        event: "merge_group",
        action: parsed.action,
        headRef: parsed.headRef,
        headSha: parsed.headSha,
        baseRef: parsed.baseRef,
        commitMessage: parsed.commitMessage,
        repository
      };
    case "deployment_status":
      return {
        event: "deployment_status",
        action: parsed.action,
        environment: parsed.environment,
        state: parsed.state,
        deploymentUrl: parsed.deploymentUrl,
        headSha: parsed.headSha,
        ref: parsed.ref,
        repository
      };
  }
}
function readEventContext(env = process.env) {
  const { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository } = env;
  if (!eventName || !eventPath) {
    return { skip: "Not running in GitHub Actions (GITHUB_EVENT_NAME / GITHUB_EVENT_PATH missing)" };
  }
  if (!repository) return { skip: "GITHUB_REPOSITORY not set" };
  const parsed = parseGitHubEvent(eventName, JSON.parse(readFileSync(eventPath, "utf8")));
  if (!parsed) return { skip: `Unsupported or incomplete ${eventName} event` };
  return { ctx: contextFromParsed(parsed, repository) };
}

// lib/adapters/github/api.ts
function readGitHubAuthFromEnv() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  return { token, repository };
}
async function githubApiGet(auth, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${auth.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${path} failed (${res.status})`);
  return res.json();
}
function pullRequestFromApi(pr) {
  return {
    title: pr.title,
    headRef: pr.head.ref,
    body: pr.body,
    htmlUrl: pr.html_url,
    merged: pr.merged_at != null,
    draft: pr.draft ?? false,
    state: pr.state,
    baseRef: pr.base.ref,
    headRepoFullName: pr.head.repo?.full_name ?? "",
    labels: (pr.labels ?? []).map((l) => l.name),
    authorLogin: pr.user?.login ?? ""
  };
}
async function findPullRequestsForCommit(auth, commitSha) {
  const [owner, repo] = auth.repository.split("/");
  if (!owner || !repo) return [];
  const pulls = await githubApiGet(
    auth,
    `/repos/${owner}/${repo}/commits/${commitSha}/pulls`
  );
  return pulls.map(pullRequestFromApi);
}
async function getPullRequest(auth, pullNumber) {
  const [owner, repo] = auth.repository.split("/");
  if (!owner || !repo) return null;
  const pr = await githubApiGet(
    auth,
    `/repos/${owner}/${repo}/pulls/${pullNumber}`
  );
  return pullRequestFromApi(pr);
}
async function listWorkflowRunJobs(auth, runId) {
  const [owner, repo] = auth.repository.split("/");
  if (!owner || !repo) return [];
  const data = await githubApiGet(
    auth,
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`
  );
  return data.jobs ?? [];
}
function isFromSameRepository(pr, repository) {
  return pr.headRepoFullName === repository;
}
async function getCommitMessage(auth, commitSha) {
  const [owner, repo] = auth.repository.split("/");
  if (!owner || !repo) return null;
  const data = await githubApiGet(
    auth,
    `/repos/${owner}/${repo}/commits/${commitSha}`
  );
  return data.commit?.message ?? null;
}

// lib/utils/formatMessage.ts
function formatMessage(template, vars) {
  return template.replace(
    /\{(\w+)\}/g,
    (_, key) => (Object.hasOwn(vars, key) ? vars[key] : void 0) ?? `{${key}}`
  );
}

// lib/utils/actionTemplateVars.ts
function commitUrl(repository, sha, suffix = "") {
  if (!repository || !sha) return "";
  const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  return `${server}/${repository}/commit/${sha}${suffix}`;
}
function actionTemplateVars(ctx, issueKey, jiraStatus) {
  const base = {
    issueKey,
    currentStatus: jiraStatus ?? "",
    status: jiraStatus ?? "",
    env: "",
    targetStatus: ""
  };
  switch (ctx.event) {
    case "pull_request":
    case "pull_request_review":
      return {
        ...base,
        url: ctx.url,
        prUrl: ctx.url,
        baseRef: ctx.pr.baseRef,
        headRef: ctx.pr.headRef,
        labels: ctx.pr.labels.join(", "),
        author: ctx.pr.authorLogin
      };
    case "workflow_run":
      return {
        ...base,
        url: ctx.runUrl,
        workflowName: ctx.workflowName,
        headRef: ctx.headBranch,
        runEvent: ctx.runEvent,
        conclusion: ctx.conclusion ?? ""
      };
    case "check_suite":
    case "check_run":
      return {
        ...base,
        url: ("checkUrl" in ctx ? ctx.checkUrl : "") || commitUrl(ctx.repository, ctx.headSha, "/checks"),
        checkName: ctx.checkName,
        headRef: ctx.headBranch,
        conclusion: ctx.conclusion ?? ""
      };
    case "issue_comment":
      return {
        ...base,
        url: ctx.url,
        prUrl: ctx.pr?.htmlUrl ?? ctx.url,
        baseRef: ctx.pr?.baseRef ?? "",
        headRef: ctx.pr?.headRef ?? ""
      };
    case "push":
      return {
        ...base,
        url: commitUrl(ctx.repository, ctx.headSha),
        headRef: ctx.ref.replace(/^refs\/heads\//, ""),
        ref: ctx.ref
      };
    case "release":
      return {
        ...base,
        url: ctx.releaseUrl,
        releaseTag: ctx.tagName,
        releaseName: ctx.releaseName
      };
    case "merge_group":
      return {
        ...base,
        url: commitUrl(ctx.repository, ctx.headSha),
        headRef: ctx.headRef,
        baseRef: ctx.baseRef
      };
    case "deployment_status":
      return {
        ...base,
        url: ctx.deploymentUrl,
        env: ctx.environment,
        deploymentState: ctx.state,
        headRef: ctx.ref
      };
    default:
      return base;
  }
}

// lib/utils/logger.ts
var PREFIX = "[jira-sync]";
function escapeData(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
var log = {
  info(message, err) {
    if (err !== void 0) {
      console.log(`${PREFIX} ${message}`, err);
    } else {
      console.log(`${PREFIX} ${message}`);
    }
  },
  error(message, err) {
    if (err !== void 0) {
      console.error(`${PREFIX} ${message}`, err);
    } else {
      console.error(`${PREFIX} ${message}`);
    }
  },
  /** A workflow annotation (`::warning file=…::`) inside Actions; a plain log line elsewhere. */
  annotate(level, message, location = {}) {
    if (process.env.GITHUB_ACTIONS === "true") {
      const properties = [
        location.file && `file=${escapeProperty(location.file)}`,
        location.line && `line=${location.line}`,
        location.column && `col=${location.column}`
      ].filter(Boolean).join(",");
      console.log(`::${level}${properties ? ` ${properties}` : ""}::${escapeData(message)}`);
      return;
    }
    const where = location.file ? `${location.file}${location.line ? `:${location.line}` : ""}${location.column ? `:${location.column}` : ""} ` : "";
    const line = `${PREFIX} ${level}: ${where}${message}`;
    if (level === "error") console.error(line);
    else console.log(line);
  }
};

// lib/actions/jiraSideEffects.ts
function linkUrl(ctx, kind) {
  const ev = ctx.event;
  if (kind === "pull_request") {
    if (ev.event === "pull_request" || ev.event === "pull_request_review") return ev.url;
    if (ev.event === "issue_comment" && ev.pr) return ev.pr.htmlUrl;
  }
  if (kind === "workflow_run" && ev.event === "workflow_run") return ev.runUrl;
  if (kind === "release" && ev.event === "release") return ev.releaseUrl;
  return "";
}
function linkTitle(ctx, kind) {
  if (kind === "pull_request") return "GitHub pull request";
  if (kind === "workflow_run") return "GitHub Actions workflow run";
  if (kind === "release" && ctx.event.event === "release") return `Release ${ctx.event.tagName}`;
  return "GitHub";
}
async function runJiraSideEffects(extras, ctx) {
  if (!extras) return;
  if (extras.linkGithub) {
    const url = linkUrl(ctx, extras.linkGithub);
    if (url) {
      await addIssueRemoteLink(ctx.jira, ctx.issueKey, url, linkTitle(ctx, extras.linkGithub));
      log.info(`Remote link (${extras.linkGithub}) on ${ctx.issueKey}`);
    }
  }
  if (extras.fields && Object.keys(extras.fields).length > 0) {
    const vars = actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus);
    const resolved = {};
    for (const [fieldId, template] of Object.entries(extras.fields)) {
      resolved[fieldId] = formatMessage(template, vars);
    }
    await updateIssueFields(ctx.jira, ctx.issueKey, resolved);
    log.info(`Updated ${Object.keys(resolved).length} field(s) on ${ctx.issueKey}`);
  }
}

// lib/actions/commentAction.ts
async function runCommentAction(step, ctx) {
  const vars = actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus);
  const text = formatMessage(ctx.compiled.messageTemplate(step.messageKey), vars);
  await addIssueComment(ctx.jira, ctx.issueKey, text);
  await runJiraSideEffects(step.extras, ctx);
  log.info(`Comment (${step.messageKey}) on ${ctx.issueKey}`);
}

// lib/utils/deployEnvironment.ts
function parseDeployEnvironment(jobs, headBranch, jobNamePattern, branchToEnv, validEnvKeys, options) {
  if (jobNamePattern) {
    for (const job of jobs) {
      const match = job.name.match(jobNamePattern);
      if (match?.[1] && Object.hasOwn(validEnvKeys, match[1])) {
        return match[1];
      }
    }
  }
  if (options?.allowBranchFallback === false) {
    return null;
  }
  const branch = (headBranch ?? "").trim();
  return Object.hasOwn(branchToEnv, branch) ? branchToEnv[branch] : null;
}

// lib/actions/deployAction.ts
async function commentWithKey(ctx, messageKey, extra) {
  const text = formatMessage(ctx.compiled.messageTemplate(messageKey), {
    ...actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus),
    ...extra
  });
  await addIssueComment(ctx.jira, ctx.issueKey, text);
}
async function runDeployAction(step, ctx) {
  if (ctx.event.event !== "workflow_run") {
    log.info("Deploy action requires workflow_run context");
    return "skipped";
  }
  const gh = readGitHubAuthFromEnv();
  let jobs = [];
  if (gh) {
    try {
      jobs = await listWorkflowRunJobs(gh, ctx.event.runId);
    } catch (err) {
      log.info("Could not list workflow jobs; using branch fallback", err);
    }
  }
  const allowBranchFallback = ctx.event.runEvent === "push";
  const deployEnv = parseDeployEnvironment(
    jobs,
    ctx.event.headBranch,
    ctx.compiled.deployJobPattern,
    ctx.compiled.branchToDeployEnv,
    ctx.compiled.deployEnvToStatus,
    { allowBranchFallback }
  );
  if (!deployEnv) {
    log.info("Could not resolve deploy environment");
    return "skipped";
  }
  const target = ctx.compiled.deployEnvToStatus[deployEnv];
  if (!target) {
    log.info(`No Jira status mapped for deploy env ${deployEnv}`);
    return "skipped";
  }
  const result = await transitionIssueToStatus(ctx.jira, ctx.issueKey, target, []);
  const vars = {
    env: deployEnv,
    status: target,
    targetStatus: target,
    currentStatus: ctx.jiraStatus ?? ""
  };
  if (!result.ok && result.reason === "no_transition") {
    const messageId = step.onNoTransition ?? ctx.compiled.options.noTransitionMessageId;
    if (messageId) {
      await commentWithKey(ctx, messageId, {
        ...vars,
        currentStatus: result.from,
        targetStatus: result.target
      });
    }
    return "no_transition";
  }
  if (result.ok && "skipped" in result && result.skipped) {
    if (step.commentWhenSkipped) {
      await commentWithKey(ctx, step.commentWhenSkipped, vars);
    }
    log.info(`${ctx.issueKey}: deploy ${deployEnv} (already ${target})`);
    return "skipped";
  }
  if (result.ok && !("skipped" in result)) {
    if (step.commentAfterSuccess) {
      await commentWithKey(ctx, step.commentAfterSuccess, vars);
    }
    await runJiraSideEffects(step.extras, ctx);
    log.info(`${ctx.issueKey}: deploy ${deployEnv} \u2192 ${target}`);
    return "ok";
  }
  return "skipped";
}
async function resolveIssueKeysForWorkflowRun(headSha, headBranch, extractAll, options) {
  const parts = { branch: headBranch };
  const gh = readGitHubAuthFromEnv();
  if (gh) {
    const prs = await findPullRequestsForCommit(gh, headSha);
    for (const pr of prs) {
      parts.title = pr.title;
      parts.body = pr.body;
      parts.branch = pr.headRef;
      const fromPr = extractAll(parts);
      if (fromPr.length > 0) return fromPr;
    }
    if (options.resolveKeyFromCommitMessage) {
      parts.commitMessage = await getCommitMessage(gh, headSha);
      const fromCommit = extractAll({
        title: parts.title,
        body: parts.body,
        commitMessage: parts.commitMessage
      });
      if (fromCommit.length > 0) return fromCommit;
    }
  }
  return extractAll({ branch: headBranch });
}

// lib/actions/transitionAction.ts
async function commentWithKey2(ctx, messageKey, extra) {
  const text = formatMessage(ctx.compiled.messageTemplate(messageKey), {
    ...actionTemplateVars(ctx.event, ctx.issueKey, ctx.jiraStatus),
    ...extra
  });
  await addIssueComment(ctx.jira, ctx.issueKey, text);
}
async function runTransitionAction(step, ctx) {
  const result = await transitionIssueToStatus(ctx.jira, ctx.issueKey, step.status, step.via ?? []);
  if (!result.ok && result.reason === "no_transition") {
    const messageId = step.onNoTransition ?? ctx.compiled.options.noTransitionMessageId;
    if (messageId) {
      await commentWithKey2(ctx, messageId, {
        currentStatus: result.from,
        targetStatus: result.target
      });
    }
    log.info(`No transition to ${step.status} for ${ctx.issueKey}`);
    return "no_transition";
  }
  if (result.ok && "skipped" in result && result.skipped) {
    if (step.commentWhenSkipped) {
      await commentWithKey2(ctx, step.commentWhenSkipped, {
        status: step.status,
        targetStatus: step.status
      });
    }
    return "skipped";
  }
  if (result.ok && !("skipped" in result)) {
    if (step.commentAfterSuccess) {
      await commentWithKey2(ctx, step.commentAfterSuccess, {
        status: result.to,
        targetStatus: result.to
      });
    }
    await runJiraSideEffects(step.extras, ctx);
    log.info(`${ctx.issueKey}: \u2192 ${step.status}`);
    return "ok";
  }
  return "skipped";
}

// lib/actions/executeAction.ts
async function executeAction(step, ctx) {
  switch (step.kind) {
    case "comment":
      await runCommentAction(step, ctx);
      return "ok";
    case "transition":
      return runTransitionAction(step, ctx);
    case "deploy":
      return runDeployAction(step, ctx);
    default: {
      const _exhaustive = step;
      return _exhaustive;
    }
  }
}

// lib/utils/issueKey.ts
function createIssueKeyExtractor(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const extractAll = (parts) => {
    const ordered = [parts.title, parts.body, parts.commitMessage, parts.branch];
    const seen = /* @__PURE__ */ new Set();
    const keys = [];
    for (const text of ordered) {
      if (!text) continue;
      for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
        const key = normalizeIssueKey(match[0]);
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return keys;
  };
  return {
    extract: (parts) => extractAll(parts)[0] ?? null,
    extractAll
  };
}
function normalizeIssueKey(raw) {
  return raw.toUpperCase();
}
function textContainsSkipMarker(text, marker) {
  if (!marker) return false;
  return text.toLowerCase().includes(marker.toLowerCase());
}

// lib/engine/matchRule.ts
function matchValue(actual, expected) {
  if (expected === void 0) return true;
  if (typeof expected === "boolean") return actual === expected;
  if (Array.isArray(expected)) {
    return typeof actual === "string" && expected.includes(actual);
  }
  return actual === expected;
}
function prLabels(pr) {
  return pr.labels ?? [];
}
function matchLabels(pr, when) {
  if (when.label !== void 0) {
    const want = Array.isArray(when.label) ? when.label : [when.label];
    if (!want.some((l) => prLabels(pr).includes(l))) return false;
  }
  if (when.notLabel !== void 0) {
    const block = Array.isArray(when.notLabel) ? when.notLabel : [when.notLabel];
    if (block.some((l) => prLabels(pr).includes(l))) return false;
  }
  return true;
}
function conditionsMatch(when, ctx, jiraStatus) {
  if (ctx.event === "pull_request") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.pr.merged, when.merged)) return false;
    if (!matchValue(ctx.pr.state, when.prState)) return false;
    if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
    if (!matchValue(ctx.pr.authorLogin, when.author)) return false;
    if (!matchLabels(ctx.pr, when)) return false;
    if (when.notDraft && ctx.pr.draft) return false;
    if (when.draft !== void 0 && ctx.pr.draft !== when.draft) return false;
  }
  if (ctx.event === "pull_request_review") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.reviewState, when.reviewState)) return false;
    if (!matchValue(ctx.pr.state, when.prState)) return false;
    if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
    if (!matchValue(ctx.pr.authorLogin, when.author)) return false;
    if (!matchLabels(ctx.pr, when)) return false;
  }
  if (ctx.event === "workflow_run") {
    if (!matchValue(ctx.workflowName, when.workflow)) return false;
    if (!matchValue(ctx.runEvent, when.runEvent)) return false;
    if (!matchValue(ctx.conclusion ?? void 0, when.conclusion)) return false;
  }
  if (ctx.event === "check_suite" || ctx.event === "check_run") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.checkName, when.checkName)) return false;
    if (!matchValue(ctx.conclusion ?? void 0, when.conclusion)) return false;
  }
  if (ctx.event === "issue_comment") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (ctx.pr) {
      if (!matchValue(ctx.pr.baseRef, when.baseRef)) return false;
      if (!matchValue(ctx.pr.headRef, when.headRef)) return false;
      if (!matchLabels(ctx.pr, when)) return false;
    } else if (when.baseRef !== void 0 || when.headRef !== void 0 || when.label !== void 0) {
      return false;
    }
  }
  if (ctx.event === "push") {
    const branch = ctx.ref.replace(/^refs\/heads\//, "");
    if (!matchValue(branch, when.headRef)) return false;
  }
  if (ctx.event === "release") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.tagName, when.releaseTag)) return false;
  }
  if (ctx.event === "merge_group") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.baseRef, when.baseRef)) return false;
    if (!matchValue(ctx.headRef, when.headRef)) return false;
  }
  if (ctx.event === "deployment_status") {
    if (!matchValue(ctx.action, when.action)) return false;
    if (!matchValue(ctx.environment, when.deploymentEnvironment)) return false;
    if (!matchValue(ctx.state, when.deploymentState)) return false;
  }
  if (when.jiraStatusIs && jiraStatus !== when.jiraStatusIs) return false;
  if (when.jiraStatusIsNot && jiraStatus === when.jiraStatusIsNot) return false;
  return true;
}
function findMatchingRule(config2, ctx, jiraStatus) {
  for (const rule of config2.rules) {
    if (rule.event !== ctx.event) continue;
    if (conditionsMatch(rule.when, ctx, jiraStatus)) return rule;
  }
  return null;
}

// lib/engine/runSync.ts
var TERMINAL_CONCLUSIONS = /* @__PURE__ */ new Set([
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "neutral",
  "skipped",
  "stale",
  "startup_failure"
]);
function shouldProcessTerminalConclusion(label, conclusion, action) {
  if (action !== "completed") {
    log.info(`${label} action "${action}" not handled; skipping`);
    return false;
  }
  if (conclusion == null || conclusion === "") {
    log.info(`${label} has no conclusion yet; skipping`);
    return false;
  }
  if (!TERMINAL_CONCLUSIONS.has(conclusion)) {
    log.info(`${label} conclusion "${conclusion}" not handled; skipping`);
    return false;
  }
  return true;
}
function shouldProcessWorkflowRun(ctx) {
  return shouldProcessTerminalConclusion("workflow_run", ctx.conclusion, "completed");
}
function shouldProcessCheck(ctx) {
  return shouldProcessTerminalConclusion(ctx.event, ctx.conclusion, ctx.action);
}
async function withPullRequest(ctx) {
  if (ctx.event !== "issue_comment" || ctx.pr || ctx.pullRequestNumber == null) return ctx;
  const gh = readGitHubAuthFromEnv();
  if (!gh) {
    log.info("GITHUB_TOKEN not set; PR comment handled without PR details");
    return ctx;
  }
  return { ...ctx, pr: await getPullRequest(gh, ctx.pullRequestNumber) };
}
function skipTextsForPullRequest(ctx) {
  return [ctx.pr.title, ctx.pr.body ?? "", ctx.pr.headRef];
}
async function skipTextsForSha(headSha, headBranch) {
  const texts = [headBranch];
  const gh = readGitHubAuthFromEnv();
  if (!gh) return texts;
  const prs = await findPullRequestsForCommit(gh, headSha);
  for (const pr of prs) {
    texts.push(pr.title, pr.body ?? "", pr.headRef);
  }
  try {
    texts.push(await getCommitMessage(gh, headSha) ?? "");
  } catch (err) {
    log.info("Could not read commit message for skip-marker check", err);
  }
  return texts;
}
async function skipTextsForContext(ctx) {
  switch (ctx.event) {
    case "pull_request":
    case "pull_request_review":
      return skipTextsForPullRequest(ctx);
    case "workflow_run":
      return skipTextsForSha(ctx.headSha, ctx.headBranch);
    case "check_suite":
    case "check_run":
      return skipTextsForSha(ctx.headSha, ctx.headBranch);
    case "deployment_status":
      return skipTextsForSha(ctx.headSha, ctx.ref.replace(/^refs\/heads\//, ""));
    case "issue_comment":
      return [
        ctx.body,
        ctx.pr?.title ?? "",
        ctx.pr?.body ?? "",
        ctx.pr?.headRef ?? ""
      ];
    case "push":
      return [...ctx.commitMessages, ctx.ref];
    case "release":
      return [ctx.tagName, ctx.releaseName];
    case "merge_group":
      return [ctx.commitMessage, ctx.headRef, ctx.baseRef];
    default:
      return [];
  }
}
async function resolveIssueKeys(compiled, ctx) {
  const keyExtractor = createIssueKeyExtractor(compiled.issueKeyPattern);
  if (ctx.event === "workflow_run" || ctx.event === "check_suite" || ctx.event === "check_run" || ctx.event === "deployment_status") {
    const branch = ctx.event === "deployment_status" ? ctx.ref.replace(/^refs\/heads\//, "") : ctx.headBranch;
    return resolveIssueKeysForWorkflowRun(
      ctx.headSha,
      branch,
      (parts) => keyExtractor.extractAll(parts),
      { resolveKeyFromCommitMessage: compiled.options.resolveKeyFromCommitMessage }
    );
  }
  if (ctx.event === "push") {
    const branch = ctx.ref.replace(/^refs\/heads\//, "");
    return keyExtractor.extractAll({
      branch,
      commitMessage: ctx.commitMessages.join("\n")
    });
  }
  if (ctx.event === "issue_comment") {
    if (ctx.pr) {
      return keyExtractor.extractAll({
        title: ctx.pr.title,
        branch: ctx.pr.headRef,
        body: `${ctx.body}
${ctx.pr.body ?? ""}`
      });
    }
    return keyExtractor.extractAll({ body: ctx.body });
  }
  if (ctx.event === "release") {
    return keyExtractor.extractAll({
      title: ctx.releaseName,
      body: ctx.tagName
    });
  }
  if (ctx.event === "merge_group") {
    return keyExtractor.extractAll({ commitMessage: ctx.commitMessage, branch: ctx.headRef });
  }
  if (ctx.event === "pull_request" || ctx.event === "pull_request_review") {
    return keyExtractor.extractAll({
      title: ctx.pr.title,
      branch: ctx.pr.headRef,
      body: ctx.pr.body
    });
  }
  return [];
}
async function syncOneIssue(compiled, ctx, jira, issueKey) {
  let jiraStatus;
  try {
    jiraStatus = await getIssueStatusName(jira, issueKey);
  } catch (err) {
    if (err instanceof JiraIssueNotFoundError) {
      log.info(`Issue ${issueKey} not found in Jira; skipping`);
      return;
    }
    throw err;
  }
  const rule = findMatchingRule(compiled.built, ctx, jiraStatus);
  if (!rule) {
    log.info(`No rule matched (${ctx.event}) for ${issueKey}`);
    return;
  }
  log.info(`Rule: ${rule.name} [${rule.id}] \u2192 ${issueKey}`);
  await executeAction(rule.then, {
    jira,
    compiled,
    issueKey,
    event: ctx,
    jiraStatus
  });
}
async function runSyncForContext(compiled, eventCtx) {
  const ctx = await withPullRequest(eventCtx);
  if (ctx.event === "pull_request" || ctx.event === "pull_request_review") {
    if (!isFromSameRepository(ctx.pr, ctx.repository)) {
      log.info("Skipping fork pull request");
      return;
    }
  }
  if (ctx.event === "issue_comment" && ctx.pr && !isFromSameRepository(ctx.pr, ctx.repository)) {
    log.info("Skipping fork pull request comment");
    return;
  }
  if (ctx.event === "workflow_run" && !shouldProcessWorkflowRun(ctx)) {
    return;
  }
  if ((ctx.event === "check_suite" || ctx.event === "check_run") && !shouldProcessCheck(ctx)) {
    return;
  }
  if (ctx.event === "workflow_run" || ctx.event === "check_suite" || ctx.event === "check_run") {
    const gh = readGitHubAuthFromEnv();
    if (gh) {
      const prs = await findPullRequestsForCommit(gh, ctx.headSha);
      if (prs.some((pr) => !isFromSameRepository(pr, gh.repository))) {
        log.info(`Skipping ${ctx.event} linked to a fork pull request`);
        return;
      }
    }
  }
  const jira = readJiraConfigFromEnv();
  if (!jira) {
    log.info("Jira secrets not configured; skipping");
    return;
  }
  const marker = compiled.options.skipMarker;
  if (marker) {
    const texts = await skipTextsForContext(ctx);
    if (texts.some((t) => textContainsSkipMarker(t, marker))) {
      log.info(`Skip marker "${marker}" present; skipping`);
      return;
    }
  }
  const issueKeys = await resolveIssueKeys(compiled, ctx);
  if (issueKeys.length === 0) {
    log.info(`No ${compiled.projectKey} issue key for event`);
    return;
  }
  let keysToProcess = issueKeys;
  if (!compiled.options.processAllMatchingIssueKeys && keysToProcess.length > 1) {
    keysToProcess = [keysToProcess[0]];
  }
  for (const issueKey of keysToProcess) {
    try {
      await syncOneIssue(compiled, ctx, jira, issueKey);
    } catch (err) {
      if (err instanceof JiraIssueNotFoundError) {
        log.info(`Issue ${issueKey} not found; skipping`);
        continue;
      }
      log.error(`Jira sync failed for ${issueKey}`, err);
      if (compiled.options.failOnJiraError) throw err;
    }
  }
}

// lib/config/dsl.ts
var ConfigBuilder = class {
  constructor(projectKey) {
    this.projectKey = projectKey;
  }
  projectKey;
  rules = [];
  messageTemplates = {};
  syncOptions = { ...DEFAULT_SYNC_OPTIONS };
  deployMeta = {
    jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
    branchToEnvironment: {},
    environmentToJiraStatus: {}
  };
  messages(map) {
    this.messageTemplates = { ...map };
    return this;
  }
  deploy(meta) {
    this.deployMeta = meta;
    return this;
  }
  options(partial) {
    this.syncOptions = { ...this.syncOptions, ...partial };
    return this;
  }
  when(event) {
    const eventKind = event;
    const conditions = {};
    const ruleIndex = this.rules.length + 1;
    let ruleId = `${eventKind}-${ruleIndex}`;
    let ruleName = `${eventKind} #${ruleIndex}`;
    const finish = (step) => {
      this.rules.push({
        id: ruleId,
        name: ruleName,
        event: eventKind,
        when: { ...conditions },
        then: step
      });
      return this;
    };
    const builder = {
      named(name) {
        ruleName = name;
        ruleId = `${eventKind}:${slugify(name)}`;
        return builder;
      },
      if(field, ...values) {
        const key = field;
        if (field === "draft" /* Draft */ && values.length === 1 && values[0] === false) {
          conditions.notDraft = true;
          return builder;
        }
        if (values.length === 1) {
          conditions[key] = values[0];
        } else {
          conditions[key] = values;
        }
        return builder;
      },
      ifNot(field) {
        if (field === "draft" /* Draft */) conditions.notDraft = true;
        return builder;
      },
      ifJiraStatus(status) {
        conditions.jiraStatusIs = status;
        return builder;
      },
      unlessJiraStatus(status) {
        conditions.jiraStatusIsNot = status;
        return builder;
      },
      transitionTo(status, options = {}) {
        return finish({
          kind: "transition",
          status,
          via: options.via,
          onNoTransition: options.onNoTransition,
          commentAfterSuccess: options.commentAfterSuccess,
          commentWhenSkipped: options.commentWhenSkipped,
          extras: options.extras
        });
      },
      deployToJiraStatus(options = {}) {
        return finish({
          kind: "deploy",
          onNoTransition: options.onNoTransition,
          commentAfterSuccess: options.commentAfterSuccess,
          commentWhenSkipped: options.commentWhenSkipped,
          extras: options.extras
        });
      },
      comment(messageKey, options = {}) {
        return finish({ kind: "comment", messageKey, extras: options.extras });
      }
    };
    return builder;
  }
  build() {
    return {
      projectKey: this.projectKey,
      messages: this.messageTemplates,
      deploy: this.deployMeta,
      rules: this.rules,
      options: this.syncOptions
    };
  }
};
function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
function config(projectKey) {
  return new ConfigBuilder(projectKey);
}

// settings.ts
var builtSyncConfig = config("PROJ").options({
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  failOnJiraError: true,
  skipMarker: "[skip-jira]"
}).messages({
  merged: "Pull request merged to {baseRef}: {url}",
  prApproved: "Pull request approved on GitHub: {url}",
  deploySuccess: "Deployed to {env} via GitHub Actions: {url}",
  deploySuccessAlreadyOnStatus: "Deploy to {env} succeeded (already on {status}): {url}",
  deployFailed: "Deploy workflow failed: {url}",
  qualityGateSuccess: "Quality Gate passed: {url}",
  qualityGateFailed: "Quality Gate failed: {url}",
  qualityGateFailedNoTransition: 'Quality Gate failed but issue could not move to {targetStatus} from "{currentStatus}": {url}',
  noTransition: 'GitHub Actions could not move this issue from "{currentStatus}" to "{targetStatus}". Run: {url}',
  releasePublished: "GitHub release {releaseTag} published: {url}"
}).deploy({
  jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
  branchToEnvironment: {
    dev: "dev",
    test: "test",
    main: "prod"
  },
  environmentToJiraStatus: {
    dev: "Deployed (Dev)",
    test: "Deployed (Test)",
    prod: "Done"
  }
}).when("pull_request" /* PullRequest */).named("PR ready \u2192 In Review").if("action" /* Action */, "opened" /* Opened */, "reopened" /* Reopened */, "ready_for_review" /* ReadyForReview */, "synchronize" /* Synchronize */, "edited" /* Edited */).if("prState" /* PrState */, "open" /* Open */).ifNot("draft" /* Draft */).if("notLabel" /* NotLabel */, "skip-jira").transitionTo("In Review", { via: ["Start review"], extras: { linkGithub: "pull_request" } }).when("pull_request" /* PullRequest */).named("PR opened as draft \u2192 In Progress").if("action" /* Action */, "opened" /* Opened */).if("prState" /* PrState */, "open" /* Open */).if("draft" /* Draft */, true).transitionTo("In Progress", { via: ["Rework"] }).when("pull_request" /* PullRequest */).named("PR draft \u2192 In Progress").if("action" /* Action */, "converted_to_draft" /* ConvertedToDraft */).if("prState" /* PrState */, "open" /* Open */).transitionTo("In Progress", { via: ["Rework"] }).when("pull_request" /* PullRequest */).named("PR merged to main \u2192 Done").if("action" /* Action */, "closed" /* Closed */).if("prState" /* PrState */, "closed" /* Closed */).if("merged" /* Merged */, true).if("baseRef" /* BaseRef */, "main").transitionTo("Done", { extras: { linkGithub: "pull_request" } }).when("pull_request" /* PullRequest */).named("PR merged \u2192 comment").if("action" /* Action */, "closed" /* Closed */).if("prState" /* PrState */, "closed" /* Closed */).if("merged" /* Merged */, true).comment("merged", { extras: { linkGithub: "pull_request" } }).when("pull_request_review" /* PullRequestReview */).named("Changes requested \u2192 In Progress").if("action" /* Action */, "submitted" /* Submitted */).if("prState" /* PrState */, "open" /* Open */).if("reviewState" /* ReviewState */, "changes_requested" /* ChangesRequested */).transitionTo("In Progress", { via: ["Request changes"] }).when("pull_request_review" /* PullRequestReview */).named("PR approved \u2192 comment").if("action" /* Action */, "submitted" /* Submitted */).if("prState" /* PrState */, "open" /* Open */).if("reviewState" /* ReviewState */, "approved" /* Approved */).comment("prApproved").when("workflow_run" /* WorkflowRun */).named("Deploy success \u2192 environment status").if("workflow" /* Workflow */, "Deploy").if("conclusion" /* Conclusion */, "success" /* Success */).deployToJiraStatus({
  commentAfterSuccess: "deploySuccess",
  commentWhenSkipped: "deploySuccessAlreadyOnStatus",
  extras: { linkGithub: "workflow_run" }
}).when("workflow_run" /* WorkflowRun */).named("Deploy failed \u2192 comment").if("workflow" /* Workflow */, "Deploy").if("conclusion" /* Conclusion */, "failure" /* Failure */, "cancelled" /* Cancelled */, "timed_out" /* TimedOut */).comment("deployFailed").when("workflow_run" /* WorkflowRun */).named("Quality gate failed (in review) \u2192 In Progress").if("workflow" /* Workflow */, "Quality Gate").if("runEvent" /* RunEvent */, "pull_request" /* PullRequest */).if("conclusion" /* Conclusion */, "failure" /* Failure */).ifJiraStatus("In Review").transitionTo("In Progress", {
  via: ["Rework"],
  onNoTransition: "qualityGateFailedNoTransition",
  commentAfterSuccess: "qualityGateFailed"
}).when("workflow_run" /* WorkflowRun */).named("Quality gate failed \u2192 comment only").if("workflow" /* Workflow */, "Quality Gate").if("runEvent" /* RunEvent */, "pull_request" /* PullRequest */).if("conclusion" /* Conclusion */, "failure" /* Failure */).unlessJiraStatus("In Review").comment("qualityGateFailed").when("workflow_run" /* WorkflowRun */).named("Quality gate success \u2192 comment").if("workflow" /* Workflow */, "Quality Gate").if("runEvent" /* RunEvent */, "pull_request" /* PullRequest */).if("conclusion" /* Conclusion */, "success" /* Success */).comment("qualityGateSuccess").when("release" /* Release */).named("Release published \u2192 comment").if("action" /* Action */, "published" /* Published */).comment("releasePublished", { extras: { linkGithub: "release" } }).build();

// run.ts
var args = new Set(process.argv.slice(2));
var validateOnly = args.has("--validate-config");
var preflight = args.has("--preflight");
function printConfigValidation() {
  const issues = validateBuiltSyncConfig(builtSyncConfig);
  for (const issue of issues) {
    const fn = issue.level === "error" ? log.error : log.info;
    fn(`[config ${issue.level}] ${issue.message}`);
  }
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length === 0) {
    log.info(
      `Config OK: ${builtSyncConfig.rules.length} rules, project ${builtSyncConfig.projectKey}`
    );
  }
  return errors.length === 0;
}
async function runPreflight() {
  if (!printConfigValidation()) {
    process.exit(1);
  }
  const jira = readJiraConfigFromEnv();
  if (!jira) {
    log.error("Preflight failed: set JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN");
    process.exit(1);
  }
  const { accountId } = await verifyJiraConnection(jira);
  log.info(`Jira auth OK (accountId ${accountId})`);
  const preflightIssues = await validateJiraStringsAgainstProject(jira, builtSyncConfig);
  for (const issue of preflightIssues) {
    const fn = issue.level === "error" ? log.error : log.info;
    fn(`[jira preflight ${issue.level}] ${issue.message}`);
  }
  if (preflightIssues.some((issue) => issue.level === "error")) process.exit(1);
  log.info("Jira status preflight OK");
  log.info(`Deploy map: ${JSON.stringify(builtSyncConfig.deploy.environmentToJiraStatus)}`);
}
async function main() {
  if (validateOnly) {
    process.exit(printConfigValidation() ? 0 : 1);
  }
  if (preflight) {
    await runPreflight();
    return;
  }
  if (!process.env.GITHUB_EVENT_NAME || !process.env.GITHUB_EVENT_PATH) {
    log.info("Not running in GitHub Actions (missing event env); exit 0");
    log.info("Local checks: node dist/verify.mjs (from the jira-sync package folder)");
    log.info("Jira preflight: node dist/verify.mjs --preflight (needs JIRA_* env)");
    return;
  }
  const compiled = compileConfig(builtSyncConfig);
  const event = readEventContext();
  if ("skip" in event) {
    log.info(`${event.skip}; skipping`);
    return;
  }
  await runSyncForContext(compiled, event.ctx);
}
main().catch((err) => {
  log.error("fatal", err);
  process.exit(1);
});
