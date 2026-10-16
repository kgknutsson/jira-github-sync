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

// lib/audit/repoPaths.ts
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
function isPackageRoot(dir) {
  return existsSync(join(dir, "settings.ts")) && existsSync(join(dir, "package.json"));
}
function packageRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (; ; ) {
    if (isPackageRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "jira-sync package root not found (expected settings.ts + package.json above dist/ or lib/)"
  );
}
function consumerRoot() {
  const pkg = packageRoot();
  const workflowsDir = dirname(pkg);
  if (basename(workflowsDir) === "workflows" && basename(dirname(workflowsDir)) === ".github") {
    return dirname(dirname(workflowsDir));
  }
  return pkg;
}
function packagePathFromConsumer() {
  return relative(consumerRoot(), packageRoot()).split(sep).join("/");
}
function readPackageFile(relativePath) {
  return readFileSync(join(packageRoot(), relativePath), "utf8");
}
function readConsumerFile(relativePath) {
  return readFileSync(join(consumerRoot(), relativePath), "utf8");
}
function consumerFileExists(relativePath) {
  return existsSync(join(consumerRoot(), relativePath));
}

// lib/config/syncCatalog.ts
var DEPLOY_FAIL_ENDS = [
  "failure" /* Failure */,
  "cancelled" /* Cancelled */,
  "timed_out" /* TimedOut */
];

// lib/config/syncOptions.ts
var DEFAULT_SYNC_OPTIONS = {
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  failOnJiraError: true,
  skipMarker: "[skip-jira]",
  noTransitionMessageId: "noTransition"
};

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

// lib/audit/flowScenarios.ts
function pr(partial) {
  return {
    headRef: "PROJ-1-branch",
    body: null,
    htmlUrl: "https://example.com/pr/1",
    merged: false,
    draft: false,
    baseRef: "dev",
    headRepoFullName: "org/repo",
    state: "open",
    labels: [],
    authorLogin: "octocat",
    ...partial
  };
}
var repo = "org/repo";
var JIRA_SYNC_FLOW_SCENARIOS = [
  {
    id: "pr-opened-ready",
    description: "Opened non-draft PR \u2192 In Review",
    ctx: {
      event: "pull_request",
      action: "opened",
      pr: pr({ title: "PROJ-1 feature" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Progress",
    expectRuleName: "PR ready \u2192 In Review"
  },
  {
    id: "pr-opened-draft",
    description: "Opened as draft \u2192 In Progress",
    ctx: {
      event: "pull_request",
      action: "opened",
      pr: pr({ title: "PROJ-1 feature", draft: true }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "Ready for Development",
    expectRuleName: "PR opened as draft \u2192 In Progress"
  },
  {
    id: "pr-closed-edited-no-reopen",
    description: "Edited closed PR must not move to In Review",
    ctx: {
      event: "pull_request",
      action: "edited",
      pr: pr({ title: "PROJ-1 feature", state: "closed" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Progress",
    expectRuleName: null
  },
  {
    id: "pr-closed-merged-main",
    description: "Merged to main \u2192 Done (before the generic merge comment rule)",
    ctx: {
      event: "pull_request",
      action: "closed",
      pr: pr({ title: "PROJ-1 feature", state: "closed", merged: true, baseRef: "main" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: "PR merged to main \u2192 Done"
  },
  {
    id: "pr-closed-not-merged",
    description: "Closed without merge \u2192 no rule",
    ctx: {
      event: "pull_request",
      action: "closed",
      pr: pr({ title: "PROJ-1 feature", state: "closed", merged: false }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: null
  },
  {
    id: "review-changes-open",
    description: "Changes requested on open PR",
    ctx: {
      event: "pull_request_review",
      action: "submitted",
      reviewState: "changes_requested",
      pr: pr({ title: "PROJ-1 feature" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: "Changes requested \u2192 In Progress"
  },
  {
    id: "review-changes-closed",
    description: "Changes requested on closed PR \u2192 ignore",
    ctx: {
      event: "pull_request_review",
      action: "submitted",
      reviewState: "changes_requested",
      pr: pr({ title: "PROJ-1 feature", state: "closed" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: null
  },
  {
    id: "qg-fail-in-review-pr-run",
    description: "QG failed on PR run while In Review",
    ctx: {
      event: "workflow_run",
      workflowName: "Quality Gate",
      runEvent: "pull_request" /* PullRequest */,
      conclusion: "failure" /* Failure */,
      headSha: "abc",
      headBranch: "feature/proj-1",
      runUrl: "https://example.com/run/1",
      runId: 1
    },
    jiraStatus: "In Review",
    expectRuleName: "Quality gate failed (in review) \u2192 In Progress"
  },
  {
    id: "qg-fail-push-run",
    description: "Nested/push QG failure must not use PR-only rules",
    ctx: {
      event: "workflow_run",
      workflowName: "Quality Gate",
      runEvent: "push",
      conclusion: "failure" /* Failure */,
      headSha: "abc",
      headBranch: "dev",
      runUrl: "https://example.com/run/2",
      runId: 2
    },
    jiraStatus: "In Review",
    expectRuleName: null
  },
  {
    id: "deploy-success",
    description: "Successful deploy \u2192 environment status",
    ctx: {
      event: "workflow_run",
      workflowName: "Deploy",
      runEvent: "push",
      conclusion: "success" /* Success */,
      headSha: "abc",
      headBranch: "dev",
      runUrl: "https://example.com/run/5",
      runId: 5
    },
    jiraStatus: "Done",
    expectRuleName: "Deploy success \u2192 environment status"
  },
  {
    id: "deploy-cancelled",
    description: "Cancelled deploy \u2192 failure comment path",
    ctx: {
      event: "workflow_run",
      workflowName: "Deploy",
      runEvent: "push",
      conclusion: "cancelled" /* Cancelled */,
      headSha: "abc",
      headBranch: "dev",
      runUrl: "https://example.com/run/3",
      runId: 3
    },
    jiraStatus: "In Progress",
    expectRuleName: "Deploy failed \u2192 comment"
  },
  {
    id: "deploy-in-progress-null",
    description: "workflow_run without terminal conclusion \u2192 no rule",
    ctx: {
      event: "workflow_run",
      workflowName: "Deploy",
      runEvent: "push",
      conclusion: null,
      headSha: "abc",
      headBranch: "dev",
      runUrl: "https://example.com/run/4",
      runId: 4
    },
    jiraStatus: "In Progress",
    expectRuleName: null
  },
  {
    id: "pr-merged-dev-comment",
    description: "Merged to dev \u2192 comment only (not Done)",
    ctx: {
      event: "pull_request",
      action: "closed",
      pr: pr({ title: "PROJ-1 feature", state: "closed", merged: true, baseRef: "dev" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: "PR merged \u2192 comment"
  },
  {
    id: "pr-skip-jira-label",
    description: "skip-jira label blocks In Review transition",
    ctx: {
      event: "pull_request",
      action: "opened",
      pr: pr({ title: "PROJ-1 feature", labels: ["skip-jira"] }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Progress",
    expectRuleName: null
  },
  {
    id: "qg-fail-not-in-review",
    description: "QG failed on PR run outside In Review \u2192 comment only",
    ctx: {
      event: "workflow_run",
      workflowName: "Quality Gate",
      runEvent: "pull_request" /* PullRequest */,
      conclusion: "failure" /* Failure */,
      headSha: "abc",
      headBranch: "feature/proj-1",
      runUrl: "https://example.com/run/6",
      runId: 6
    },
    jiraStatus: "In Progress",
    expectRuleName: "Quality gate failed \u2192 comment only"
  },
  {
    id: "review-approved",
    description: "Approved review on open PR \u2192 comment",
    ctx: {
      event: "pull_request_review",
      action: "submitted",
      reviewState: "approved",
      pr: pr({ title: "PROJ-1 feature" }),
      repository: repo,
      url: "https://example.com/pr/1"
    },
    jiraStatus: "In Review",
    expectRuleName: "PR approved \u2192 comment"
  },
  {
    id: "release-published",
    description: "Published release \u2192 comment",
    ctx: {
      event: "release",
      action: "published",
      tagName: "v1.0.0",
      releaseName: "PROJ-1 release",
      releaseUrl: "https://example.com/releases/v1.0.0",
      repository: repo
    },
    jiraStatus: "Done",
    expectRuleName: "Release published \u2192 comment"
  }
];

// lib/audit/syncAudit.ts
function collectWorkflowNamesInRules() {
  const names = /* @__PURE__ */ new Set();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== "workflow_run") continue;
    const wf = rule.when.workflow;
    if (typeof wf === "string") names.add(wf);
    if (Array.isArray(wf)) wf.forEach((w) => names.add(w));
  }
  return [...names];
}
function collectActionsInRules(event) {
  const actions = /* @__PURE__ */ new Set();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== event) continue;
    const action = rule.when.action;
    if (typeof action === "string") actions.add(action);
    if (Array.isArray(action)) action.forEach((a) => actions.add(a));
  }
  return [...actions];
}
function deployWorkflowNameFromConfig() {
  const rule = builtSyncConfig.rules.find(
    (r) => r.event === "workflow_run" && r.then.kind === "deploy"
  );
  const wf = rule?.when.workflow;
  return typeof wf === "string" ? wf : "";
}
function captureGroupCount(source) {
  return new RegExp(`${source}|`).exec("").length - 1;
}
function unquoteYamlItem(item) {
  return item.trim().replace(/^(['"])(.*)\1$/, "$2");
}
function extractYamlStringList(source, key) {
  const inline = source.match(new RegExp(`(?<![\\w-])${key}:\\s*\\[([^\\]]*)\\]`, "s"))?.[1];
  if (inline !== void 0) {
    const withoutComments = inline.replace(/(^|\s)#.*$/gm, "$1");
    return [...withoutComments.matchAll(/'([^']*)'|"([^"]*)"|([^,'"\s][^,]*)/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim()).filter(Boolean);
  }
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*(#.*)?$`).test(line));
  if (start === -1) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = line.match(/^\s*-\s*(.+?)\s*(?:\s#.*)?$/);
    if (!item) break;
    items.push(unquoteYamlItem(item[1]));
  }
  return items;
}
var DEFAULT_TRIGGER_TYPES = {
  pull_request: ["opened", "synchronize", "reopened"]
};
function extractOnTriggerBlock(yml, trigger) {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^  ${escaped}:[^\\n]*\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9_]*:|^concurrency:|^permissions:|^env:|^jobs:)`,
    "m"
  );
  return yml.match(re)?.[0] ?? "";
}
function auditJiraSyncConfig() {
  const violations = [];
  for (const issue of validateBuiltSyncConfig(builtSyncConfig)) {
    violations.push({
      ruleId: issue.level === "error" ? "config-validation" : "config-warning",
      message: issue.message
    });
  }
  const { deploy } = builtSyncConfig;
  if (builtSyncConfig.rules.some((r) => r.then.kind === "deploy")) {
    if (Object.keys(deploy.environmentToJiraStatus).length === 0) {
      violations.push({
        ruleId: "deploy-map-empty",
        message: "deployToJiraStatus() is used but .deploy({ environmentToJiraStatus }) is empty"
      });
    }
    let groups = 1;
    try {
      if (deploy.jobNameRegex !== void 0) groups = captureGroupCount(deploy.jobNameRegex);
    } catch {
    }
    if (groups < 1) {
      violations.push({
        ruleId: "deploy-job-regex",
        message: "deploy.jobNameRegex needs a capture group for the environment, e.g. \\((dev|prod)\\)"
      });
    }
  }
  for (const env of Object.values(deploy.branchToEnvironment)) {
    if (!Object.hasOwn(deploy.environmentToJiraStatus, env)) {
      violations.push({
        ruleId: "deploy-env-map",
        message: `branch maps to "${env}" but environmentToJiraStatus has no entry`
      });
    }
  }
  return violations;
}
function auditJiraSyncFlowRules() {
  const violations = [];
  const deployWorkflow = deployWorkflowNameFromConfig();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event === "pull_request" && rule.then.kind === "transition") {
      const prState = rule.when.prState;
      const requiresOpen = prState === "open" || Array.isArray(prState) && prState.includes("open");
      if (!requiresOpen && rule.when.merged !== true) {
        violations.push({
          ruleId: "flow-pr-transition-state",
          message: `Rule "${rule.name}" transitions on pull_request but does not require prState open`
        });
      }
    }
    if (rule.event === "pull_request_review") {
      const prState = rule.when.prState;
      const requiresOpen = prState === "open" || Array.isArray(prState) && prState.includes("open");
      if (!requiresOpen) {
        violations.push({
          ruleId: "flow-review-state",
          message: `Rule "${rule.name}" handles pull_request_review but does not require prState open`
        });
      }
    }
    if (deployWorkflow && rule.event === "workflow_run" && rule.when.workflow === deployWorkflow && rule.then.kind === "comment" && rule.name.toLowerCase().includes("failed")) {
      const conclusion = rule.when.conclusion;
      const arr = Array.isArray(conclusion) ? conclusion : conclusion ? [conclusion] : [];
      for (const required of DEPLOY_FAIL_ENDS) {
        if (!arr.includes(required)) {
          violations.push({
            ruleId: "flow-deploy-failure-conclusions",
            message: `Deploy failure rule "${rule.name}" should include conclusion "${required}"`
          });
        }
      }
    }
  }
  return violations;
}
function auditJiraSyncWorkflowYaml() {
  const violations = [];
  if (!consumerFileExists(".github/workflows/jira-sync.yml")) {
    violations.push({
      ruleId: "workflow-missing",
      message: "Missing .github/workflows/jira-sync.yml in consumer repo (copy from templates/jira-sync.workflow.yml)"
    });
    return violations;
  }
  const yml = readConsumerFile(".github/workflows/jira-sync.yml");
  const settingsEvents = new Set(builtSyncConfig.rules.map((r) => r.event));
  const packagePath = packagePathFromConsumer();
  const bundledRunner = `node ${packagePath ? `${packagePath}/` : ""}dist/run.mjs`;
  const runnerCmds = [.../* @__PURE__ */ new Set([bundledRunner, "node dist/run.mjs"])];
  if (!runnerCmds.some((cmd) => yml.includes(cmd))) {
    violations.push({
      ruleId: "workflow-entry",
      message: `jira-sync.yml must run the bundled runner (${runnerCmds.join(" or ")})`
    });
  }
  const requireTypes = (trigger, required, ruleId) => {
    if (required.length === 0) return;
    const block = extractOnTriggerBlock(yml, trigger);
    let types = block ? extractYamlStringList(block, "types") : [];
    if (block && types.length === 0) {
      const defaults = DEFAULT_TRIGGER_TYPES[trigger];
      if (!defaults) return;
      types = defaults;
    }
    for (const type of required) {
      if (!types.includes(type)) {
        violations.push({
          ruleId,
          message: `jira-sync.yml ${trigger}.types missing "${type}" (required by settings.ts)`
        });
      }
    }
  };
  requireTypes("pull_request", collectActionsInRules("pull_request"), "pr-trigger-gap");
  requireTypes(
    "pull_request_review",
    collectActionsInRules("pull_request_review"),
    "pr-review-trigger"
  );
  requireTypes("release", collectActionsInRules("release"), "release-trigger");
  if (settingsEvents.has("check_suite")) {
    requireTypes("check_suite", ["completed"], "check-suite-trigger");
  }
  if (settingsEvents.has("check_run")) {
    requireTypes("check_run", ["completed"], "check-run-trigger");
  }
  const wrBlock = extractOnTriggerBlock(yml, "workflow_run");
  const listened = wrBlock ? extractYamlStringList(wrBlock, "workflows") : [];
  for (const name of collectWorkflowNamesInRules()) {
    if (!listened.includes(name)) {
      violations.push({
        ruleId: "workflow-listen",
        message: `jira-sync.yml workflow_run.workflows missing "${name}"`
      });
    }
  }
  if (wrBlock && !extractYamlStringList(wrBlock, "types").includes("completed")) {
    violations.push({
      ruleId: "workflow-run-types",
      message: "jira-sync.yml workflow_run.types must include completed"
    });
  }
  if (settingsEvents.has("workflow_run") && !yml.includes("workflow_run.repository.id == github.repository_id")) {
    violations.push({
      ruleId: "workflow-cross-repo",
      message: "jira-sync job should guard workflow_run to same repository"
    });
  }
  if (!yml.includes("pull-requests: read")) {
    violations.push({
      ruleId: "workflow-permissions",
      message: "jira-sync.yml needs pull-requests: read for commit\u2192PR issue key lookup"
    });
  }
  if ((settingsEvents.has("check_suite") || settingsEvents.has("check_run")) && !yml.includes("checks: read")) {
    violations.push({
      ruleId: "workflow-permissions-checks",
      message: "jira-sync.yml needs checks: read for check_suite / check_run sync"
    });
  }
  for (const secret of ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"]) {
    if (!yml.includes(secret)) {
      violations.push({
        ruleId: "workflow-secrets",
        message: `jira-sync.yml must pass ${secret} to the sync step`
      });
    }
  }
  if (!/GITHUB_TOKEN:\s*\$\{\{\s*(secrets\.GITHUB_TOKEN|github\.token)\s*\}\}/.test(yml)) {
    violations.push({
      ruleId: "workflow-github-token",
      message: "jira-sync.yml must pass GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} (PR / commit issue-key lookup)"
    });
  }
  return violations;
}
function auditJiraSyncLayout() {
  const violations = [];
  const required = [
    "package.json",
    "build.mjs",
    "dist/run.mjs",
    "dist/verify.mjs",
    "run.ts",
    "verify.ts",
    "lib/config/syncCatalog.ts",
    "settings.ts",
    "lib/audit/syncAudit.ts",
    "lib/engine/runSync.ts",
    "lib/adapters/jira/client.ts",
    "authoring-guide.md",
    "setup.md"
  ];
  for (const rel of required) {
    try {
      readPackageFile(rel);
    } catch {
      violations.push({ ruleId: "layout-missing", message: `Missing required file ${rel}` });
    }
  }
  return violations;
}
function runJiraSyncAudit() {
  return [
    ...auditJiraSyncLayout(),
    ...auditJiraSyncConfig(),
    ...auditJiraSyncFlowRules(),
    ...auditJiraSyncWorkflowYaml()
  ];
}

// lib/adapters/jira/client.ts
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

// lib/utils/logger.ts
var PREFIX = "[jira-sync]";
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
  }
};

// verify.ts
var args = new Set(process.argv.slice(2));
async function main() {
  const configErrors = validateBuiltSyncConfig(builtSyncConfig).filter((i) => i.level === "error");
  if (configErrors.length > 0) {
    for (const issue of configErrors) {
      log.error(`[config] ${issue.message}`);
    }
    process.exit(1);
  }
  const violations = runJiraSyncAudit();
  for (const v of violations) {
    const fn = v.ruleId === "config-warning" ? log.info : log.error;
    fn(`[${v.ruleId}] ${v.message}`);
  }
  if (violations.some((v) => v.ruleId !== "config-warning")) {
    process.exit(1);
  }
  log.info(
    `Jira sync verify OK: ${builtSyncConfig.rules.length} rules, project ${builtSyncConfig.projectKey}`
  );
  if (args.has("--preflight")) {
    const jira = readJiraConfigFromEnv();
    if (!jira) {
      log.error("Preflight failed: set JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN");
      process.exit(1);
    }
    const { accountId } = await verifyJiraConnection(jira);
    log.info(`Jira preflight OK (accountId ${accountId})`);
    const preflightIssues = await validateJiraStringsAgainstProject(jira, builtSyncConfig);
    for (const issue of preflightIssues) {
      const fn = issue.level === "error" ? log.error : log.info;
      fn(`[jira preflight ${issue.level}] ${issue.message}`);
    }
    if (preflightIssues.some((issue) => issue.level === "error")) process.exit(1);
    log.info("Jira workflow status names OK");
  }
}
main().catch((err) => {
  log.error("fatal", err);
  process.exit(1);
});
