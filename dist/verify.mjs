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
import { join } from "node:path";
var cwd = () => process.cwd();
function consumerRoot() {
  return cwd();
}
function packageRoot() {
  const root = cwd();
  const candidates = [root, join(root, ".github/workflows/jira-sync")];
  for (const dir of candidates) {
    if (existsSync(join(dir, "settings.ts")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
  }
  throw new Error(
    "jira-sync package root not found (expected settings.ts + package.json at repo root or .github/workflows/jira-sync/)"
  );
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
}).when("workflow_run" /* WorkflowRun */).named("Quality gate failed \u2192 comment only").if("workflow" /* Workflow */, "Quality Gate").if("runEvent" /* RunEvent */, "pull_request" /* PullRequest */).if("conclusion" /* Conclusion */, "failure" /* Failure */).unlessJiraStatus("In Review").comment("qualityGateFailed").when("workflow_run" /* WorkflowRun */).named("Quality gate success \u2192 comment").if("workflow" /* Workflow */, "Quality Gate").if("runEvent" /* RunEvent */, "pull_request" /* PullRequest */).if("conclusion" /* Conclusion */, "success" /* Success */).comment("qualityGateSuccess").when("check_suite" /* CheckSuite */).named("Check suite failed (in review) \u2192 In Progress").if("checkName" /* CheckName */, "GitHub Actions").if("conclusion" /* Conclusion */, "failure" /* Failure */).ifJiraStatus("In Review").transitionTo("In Progress", {
  via: ["Rework"],
  onNoTransition: "qualityGateFailedNoTransition",
  commentAfterSuccess: "qualityGateFailed"
}).when("release" /* Release */).named("Release published \u2192 comment").if("action" /* Action */, "published" /* Published */).comment("releasePublished", { extras: { linkGithub: "release" } }).build();

// lib/config/validateConfig.ts
function collectMessageKeysFromStep(step) {
  const keys = [];
  if (step.kind === "comment") keys.push(step.messageKey);
  if (step.kind === "transition") {
    if (step.onNoTransition) keys.push(step.onNoTransition);
    if (step.commentAfterSuccess) keys.push(step.commentAfterSuccess);
    if (step.commentWhenSkipped) keys.push(step.commentWhenSkipped);
  }
  if (step.kind === "deploy") {
    if (step.onNoTransition) keys.push(step.onNoTransition);
    if (step.commentAfterSuccess) keys.push(step.commentAfterSuccess);
    if (step.commentWhenSkipped) keys.push(step.commentWhenSkipped);
  }
  return keys;
}
function validateBuiltSyncConfig(built) {
  const issues = [];
  if (!built.projectKey.trim()) {
    issues.push({ level: "error", message: "projectKey is empty" });
  }
  if (built.rules.length === 0) {
    issues.push({ level: "error", message: "No rules defined" });
  }
  const ruleIds = /* @__PURE__ */ new Set();
  for (const rule of built.rules) {
    if (ruleIds.has(rule.id)) {
      issues.push({ level: "error", message: `Duplicate rule id: ${rule.id}` });
    }
    ruleIds.add(rule.id);
    for (const key of collectMessageKeysFromStep(rule.then)) {
      if (!built.messages[key]) {
        issues.push({
          level: "error",
          message: `Rule "${rule.name}" references unknown message key: ${key}`
        });
      }
    }
  }
  try {
    new RegExp(built.deploy.jobNameRegex);
  } catch {
    issues.push({ level: "error", message: "deploy.jobNameRegex is invalid" });
  }
  const envKeys = Object.keys(built.deploy.environmentToJiraStatus);
  for (const branch of Object.values(built.deploy.branchToEnvironment)) {
    if (!envKeys.includes(branch)) {
      issues.push({
        level: "warning",
        message: `branchToEnvironment maps to "${branch}" but environmentToJiraStatus has no such key`
      });
    }
  }
  if (Object.keys(built.messages).length === 0) {
    issues.push({ level: "warning", message: "No message templates defined" });
  }
  const defaultNoTransition = {
    ...DEFAULT_SYNC_OPTIONS,
    ...built.options
  }.noTransitionMessageId;
  if (defaultNoTransition != null && !built.messages[defaultNoTransition]) {
    issues.push({
      level: "error",
      message: `options.noTransitionMessageId references unknown message key: ${defaultNoTransition}`
    });
  }
  const referenced = /* @__PURE__ */ new Set();
  if (defaultNoTransition) referenced.add(defaultNoTransition);
  for (const rule of built.rules) {
    for (const key of collectMessageKeysFromStep(rule.then)) {
      referenced.add(key);
    }
  }
  for (const key of Object.keys(built.messages)) {
    if (!referenced.has(key)) {
      issues.push({
        level: "warning",
        message: `Message template "${key}" is never referenced by a rule`
      });
    }
  }
  return issues;
}
function assertValidConfig(built) {
  const issues = validateBuiltSyncConfig(built).filter((i) => i.level === "error");
  if (issues.length > 0) {
    throw new Error(
      `Invalid jira-sync settings:
${issues.map((i) => `- ${i.message}`).join("\n")}`
    );
  }
}

// lib/config/compileConfig.ts
function compileConfig(built, validate = true) {
  if (validate) assertValidConfig(built);
  const options = { ...DEFAULT_SYNC_OPTIONS, ...built.options };
  const issueKeyPattern = new RegExp(String.raw`\b${built.projectKey}-\d+\b`, "gi");
  return {
    built: { ...built, options },
    projectKey: built.projectKey,
    options,
    issueKeyPattern,
    deployJobPattern: new RegExp(built.deploy.jobNameRegex),
    deployEnvToStatus: built.deploy.environmentToJiraStatus,
    branchToDeployEnv: built.deploy.branchToEnvironment,
    messageTemplate(key) {
      const t = built.messages[key];
      if (!t) throw new Error(`Unknown message key: ${key}`);
      return t;
    }
  };
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
function prLabels(pr2) {
  return pr2.labels ?? [];
}
function matchLabels(pr2, when) {
  if (when.label !== void 0) {
    const want = Array.isArray(when.label) ? when.label : [when.label];
    if (!want.some((l) => prLabels(pr2).includes(l))) return false;
  }
  if (when.notLabel !== void 0) {
    const block = Array.isArray(when.notLabel) ? when.notLabel : [when.notLabel];
    if (block.some((l) => prLabels(pr2).includes(l))) return false;
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
    id: "pr-closed-merged-comment",
    description: "Merged close \u2192 comment only",
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
    id: "check-suite-fail-in-review",
    description: "Check suite failed while In Review",
    ctx: {
      event: "check_suite",
      action: "completed",
      checkName: "GitHub Actions",
      conclusion: "failure" /* Failure */,
      headSha: "abc",
      headBranch: "feature/proj-1",
      repository: repo
    },
    jiraStatus: "In Review",
    expectRuleName: "Check suite failed (in review) \u2192 In Progress"
  }
];
function evaluateFlowScenario(scenario) {
  const rule = findMatchingRule(builtSyncConfig, scenario.ctx, scenario.jiraStatus);
  const matchedRuleName = rule?.name ?? null;
  return {
    matchedRuleName,
    ok: matchedRuleName === scenario.expectRuleName
  };
}
function runJiraSyncFlowScenarioAudit() {
  const failures = [];
  for (const scenario of JIRA_SYNC_FLOW_SCENARIOS) {
    const { matchedRuleName, ok } = evaluateFlowScenario(scenario);
    if (!ok) {
      failures.push({
        id: scenario.id,
        message: `${scenario.description}: expected rule ${scenario.expectRuleName ?? "null"}, got ${matchedRuleName ?? "null"}`
      });
    }
  }
  return failures;
}

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
function deployWorkflowNameFromConfig() {
  const rule = builtSyncConfig.rules.find(
    (r) => r.event === "workflow_run" && r.then.kind === "deploy"
  );
  const wf = rule?.when.workflow;
  return typeof wf === "string" ? wf : "";
}
function qualityGateWorkflowNameFromConfig() {
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== "workflow_run") continue;
    const runEvent = rule.when.runEvent;
    const isPrRun = runEvent === "pull_request" /* PullRequest */ || Array.isArray(runEvent) && runEvent.includes("pull_request" /* PullRequest */);
    if (!isPrRun) continue;
    const wf = rule.when.workflow;
    if (typeof wf === "string") return wf;
  }
  return "";
}
var EXPECTED_WORKFLOW_NAMES = collectWorkflowNamesInRules();
var SETTINGS_PR_ACTIONS = /* @__PURE__ */ new Set();
for (const rule of builtSyncConfig.rules) {
  if (rule.event !== "pull_request") continue;
  const action = rule.when.action;
  if (typeof action === "string") SETTINGS_PR_ACTIONS.add(action);
  if (Array.isArray(action)) action.forEach((a) => SETTINGS_PR_ACTIONS.add(a));
}
function extractYamlStringList(source, key) {
  const inline = source.match(new RegExp(`${key}:\\s*\\[([^\\]]+)\\]`, "s"));
  const inner = inline?.[1] ?? source.match(new RegExp(`${key}:\\s*\\n\\s*\\[([^\\]]+)\\]`, "s"))?.[1];
  if (!inner) return [];
  const quoted = [...inner.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (quoted.length > 0) return quoted;
  return [...inner.matchAll(/['"]?([a-z_]+)['"]?/gi)].map((m) => m[1]).filter(Boolean);
}
function extractOnTriggerBlock(yml, trigger) {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^  ${escaped}:\\s*\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9_]*:|^concurrency:|^permissions:|^env:|^jobs:)`,
    "m"
  );
  return yml.match(re)?.[0] ?? "";
}
function extractPullRequestTypes(yml) {
  const prBlock = extractOnTriggerBlock(yml, "pull_request");
  if (!prBlock) return [];
  return extractYamlStringList(prBlock, "types");
}
function auditJiraSyncConfig() {
  const violations = [];
  for (const issue of validateBuiltSyncConfig(builtSyncConfig)) {
    violations.push({
      ruleId: issue.level === "error" ? "config-validation" : "config-warning",
      message: issue.message
    });
  }
  const ruleIds = /* @__PURE__ */ new Set();
  for (const rule of builtSyncConfig.rules) {
    if (ruleIds.has(rule.id)) {
      violations.push({ ruleId: "duplicate-rule-id", message: `Duplicate rule id: ${rule.id}` });
    }
    ruleIds.add(rule.id);
  }
  const compiled = compileConfig(builtSyncConfig, false);
  const sampleJob = "Build and Deploy (test)";
  if (!compiled.deployJobPattern.test(sampleJob)) {
    violations.push({
      ruleId: "deploy-job-regex",
      message: `deploy.jobNameRegex does not match sample job name "${sampleJob}"`
    });
  }
  for (const env of Object.values(builtSyncConfig.deploy.branchToEnvironment)) {
    if (!(env in builtSyncConfig.deploy.environmentToJiraStatus)) {
      violations.push({
        ruleId: "deploy-env-map",
        message: `branch maps to "${env}" but environmentToJiraStatus has no entry`
      });
    }
  }
  const workflowNamesInRules = /* @__PURE__ */ new Set();
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== "workflow_run") continue;
    const wf = rule.when.workflow;
    if (typeof wf === "string") workflowNamesInRules.add(wf);
    if (Array.isArray(wf)) wf.forEach((w) => workflowNamesInRules.add(w));
  }
  for (const name of workflowNamesInRules) {
    if (!EXPECTED_WORKFLOW_NAMES.includes(name)) {
      violations.push({
        ruleId: "unknown-workflow-name",
        message: `Rule references workflow "${name}" not in expected list`
      });
    }
  }
  for (const expected of EXPECTED_WORKFLOW_NAMES) {
    if (!workflowNamesInRules.has(expected)) {
      violations.push({
        ruleId: "missing-workflow-rule",
        message: `No workflow_run rule targets workflow "${expected}"`
      });
    }
  }
  for (const rule of builtSyncConfig.rules) {
    if (rule.event !== "workflow_run") continue;
    const wf = rule.when.workflow;
    const qg = qualityGateWorkflowNameFromConfig();
    const isQg = wf === qg || Array.isArray(wf) && wf.includes(qg);
    if (!isQg) continue;
    const runEvent = rule.when.runEvent;
    const prRun = "pull_request" /* PullRequest */;
    const ok = runEvent === prRun || Array.isArray(runEvent) && runEvent.includes(prRun);
    if (!ok) {
      violations.push({
        ruleId: "qg-run-event",
        message: `Rule "${rule.name}" targets Quality Gate but missing runEvent pull_request (avoids nested deploy QG noise)`
      });
    }
  }
  return violations;
}
function auditJiraSyncFlowRules() {
  const violations = [];
  for (const failure of runJiraSyncFlowScenarioAudit()) {
    violations.push({ ruleId: "flow-scenario", message: `[${failure.id}] ${failure.message}` });
  }
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
    if (rule.event === "workflow_run" && rule.when.workflow === deployWorkflowNameFromConfig() && rule.then.kind === "comment" && rule.name.toLowerCase().includes("failed")) {
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
  const runnerCmds = [
    "node .github/workflows/jira-sync/dist/run.mjs",
    "node dist/run.mjs"
  ];
  if (!runnerCmds.some((cmd) => yml.includes(cmd))) {
    violations.push({
      ruleId: "workflow-entry",
      message: `jira-sync.yml must run bundled runner (${runnerCmds.join(" or ")}); no repo-root pnpm install`
    });
  }
  if (yml.includes("pnpm install --frozen-lockfile") && !yml.includes("working-directory: .github/workflows/jira-sync")) {
    violations.push({
      ruleId: "workflow-root-install",
      message: "jira-sync.yml must not run repo-root pnpm install (use bundled dist/run.mjs)"
    });
  }
  if (yml.includes("pnpm exec tsx .github/workflows/jira-sync/run.ts")) {
    violations.push({
      ruleId: "workflow-entry-legacy",
      message: "jira-sync.yml must not invoke run.ts via tsx; rebuild dist and use dist/run.mjs"
    });
  }
  const wrBlock = extractOnTriggerBlock(yml, "workflow_run");
  const listened = wrBlock ? extractYamlStringList(wrBlock, "workflows") : [];
  for (const name of EXPECTED_WORKFLOW_NAMES) {
    if (!listened.includes(name)) {
      violations.push({
        ruleId: "workflow-listen",
        message: `jira-sync.yml workflow_run.workflows missing "${name}"`
      });
    }
  }
  const prTypesFromBlock = extractPullRequestTypes(yml);
  for (const action of SETTINGS_PR_ACTIONS) {
    if (!prTypesFromBlock.includes(action)) {
      violations.push({
        ruleId: "pr-trigger-gap",
        message: `jira-sync.yml pull_request.types missing "${action}" (required by settings.ts)`
      });
    }
  }
  if (!yml.includes("pull-requests: read")) {
    violations.push({
      ruleId: "workflow-permissions",
      message: "jira-sync.yml needs pull-requests: read for commit\u2192PR issue key lookup"
    });
  }
  if (!yml.includes("checks: read")) {
    violations.push({
      ruleId: "workflow-permissions-checks",
      message: "jira-sync.yml needs checks: read for check_suite / check_run sync"
    });
  }
  const settingsEvents = new Set(builtSyncConfig.rules.map((r) => r.event));
  if (settingsEvents.has("check_suite")) {
    const csBlock = extractOnTriggerBlock(yml, "check_suite");
    if (!csBlock || !extractYamlStringList(csBlock, "types").includes("completed")) {
      violations.push({
        ruleId: "check-suite-trigger",
        message: "jira-sync.yml check_suite.types must include completed (settings has check_suite rules)"
      });
    }
  }
  if (settingsEvents.has("release")) {
    const relBlock = extractOnTriggerBlock(yml, "release");
    if (!relBlock || !extractYamlStringList(relBlock, "types").includes("published")) {
      violations.push({
        ruleId: "release-trigger",
        message: "jira-sync.yml release.types must include published (settings has release rules)"
      });
    }
  }
  if (!yml.includes("JIRA_BASE_URL") || !yml.includes("JIRA_API_TOKEN")) {
    violations.push({
      ruleId: "workflow-secrets",
      message: "jira-sync.yml must pass JIRA_* secrets to the sync step"
    });
  }
  if (!yml.includes("workflow_run.repository.id == github.repository_id")) {
    violations.push({
      ruleId: "workflow-cross-repo",
      message: "jira-sync job should guard workflow_run to same repository"
    });
  }
  const reviewBlock = extractOnTriggerBlock(yml, "pull_request_review");
  const reviewTypes = reviewBlock ? extractYamlStringList(reviewBlock, "types") : [];
  if (!reviewTypes.includes("submitted")) {
    violations.push({
      ruleId: "pr-review-trigger",
      message: "jira-sync.yml pull_request_review.types must include submitted"
    });
  }
  if (wrBlock && !extractYamlStringList(wrBlock, "types").includes("completed")) {
    violations.push({
      ruleId: "workflow-run-types",
      message: "jira-sync.yml workflow_run.types must include completed"
    });
  }
  return violations;
}
function auditJiraSyncDocs() {
  return auditPackageDocs([]);
}
function auditPackageDocs(violations) {
  const guide = readPackageFile("authoring-guide.md");
  const setup = readPackageFile("setup.md");
  const requiredInGuide = [
    "settings.ts",
    "syncCatalog.ts",
    "When",
    "If",
    "noTransitionMessageId",
    "[skip-jira]",
    "jira-sync.yml"
  ];
  for (const snippet of requiredInGuide) {
    if (!guide.includes(snippet)) {
      violations.push({
        ruleId: "doc-coverage",
        message: `authoring-guide.md missing "${snippet}"`
      });
    }
  }
  const requiredInSetup = ["JIRA_BASE_URL", "JIRA_API_TOKEN", "--preflight", "settings.ts"];
  for (const snippet of requiredInSetup) {
    if (!setup.includes(snippet)) {
      violations.push({
        ruleId: "doc-coverage",
        message: `setup.md missing "${snippet}"`
      });
    }
  }
  for (const status of jiraStatusNamesFromConfig(builtSyncConfig)) {
    if (!guide.toLowerCase().includes(status.toLowerCase()) && !setup.includes(status)) {
      violations.push({
        ruleId: "doc-event-matrix",
        message: `authoring-guide.md or setup.md should mention Jira status "${status}" from settings.ts`
      });
    }
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
    ...auditJiraSyncWorkflowYaml(),
    ...auditJiraSyncDocs()
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
    console.error(`${PREFIX} ${message}`, err ?? "");
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
    for (const issue of await validateJiraStringsAgainstProject(jira, builtSyncConfig)) {
      const fn = issue.level === "error" ? log.error : log.info;
      fn(`[jira preflight ${issue.level}] ${issue.message}`);
      if (issue.level === "error") process.exit(1);
    }
    log.info("Jira workflow status names OK");
  }
}
main().catch((err) => {
  log.error("fatal", err);
  process.exit(1);
});
