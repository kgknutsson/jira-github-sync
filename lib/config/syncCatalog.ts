/**
 * # GitHub sync catalog (engine enums)
 *
 * Typed values for **standard GitHub** webhooks and Actions payloads. Same in every repository.
 *
 * | You configure in `settings.ts` | You import from here |
 * | -------------------------------- | -------------------- |
 * | Jira status / transition strings | — |
 * | Workflow `name:` strings | — |
 * | Comment template ids + bodies | — |
 * | Rule chains | {@link When}, {@link If}, {@link PrAct}, {@link RunEnd}, … |
 *
 * **Doc pattern for every enum below**
 * - **GitHub source** — JSON path in the webhook payload
 * - **Use with** — which `.when(When.…)` blocks and `.if(If.…)` fields apply
 * - **@example** — copy-paste rule fragments for `settings.ts`
 *
 * @module config/syncCatalog
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads
 */

/**
 * Webhook family for `.when(When.…)` — must match `github.event_name` / `rule.event`.
 *
 * **GitHub source:** top-level webhook event name (e.g. `pull_request`).
 *
 * **Use with:** Start every rule chain in `settings.ts`. Follow with `.if(If.…, …)` only for
 * fields that exist on that event (see {@link If} compatibility table in its docblock).
 *
 * @example Pull request — move to In Review when PR is ready
 * ```ts
 * .when(When.PullRequest)
 * .if(If.Action, PrAct.Opened, PrAct.Synchronize)
 * .if(If.PrState, Pr.Open)
 * .ifNot(If.Draft)
 * .transitionTo('In Review', { via: ['Start review'] })
 * ```
 *
 * @example Pull request review — changes requested
 * ```ts
 * .when(When.PullRequestReview)
 * .if(If.Action, ReviewAct.Submitted)
 * .if(If.ReviewState, Review.ChangesRequested)
 * .if(If.PrState, Pr.Open)
 * .transitionTo('In Progress', { via: ['Request changes'] })
 * ```
 *
 * @example Workflow run — deploy succeeded
 * ```ts
 * .when(When.WorkflowRun)
 * .if(If.Workflow, 'Deploy')
 * .if(If.Conclusion, RunEnd.Success)
 * .deployToJiraStatus({ commentAfterSuccess: 'deploySuccess' })
 * ```
 *
 * @example Check suite — third-party CI failed while issue is In Review
 * ```ts
 * .when(When.CheckSuite)
 * .if(If.CheckName, 'CircleCI Checks')
 * .if(If.Conclusion, CheckEnd.Failure)
 * .ifJiraStatus('In Review')
 * .transitionTo('In Progress', { via: ['Rework'] })
 * ```
 *
 * @example Release — published
 * ```ts
 * .when(When.Release)
 * .if(If.Action, ReleaseAct.Published)
 * .comment('releasePublished')
 * ```
 *
 * @example Deployment status — GitHub Environment
 * ```ts
 * .when(When.DeploymentStatus)
 * .if(If.DeploymentEnvironment, 'production')
 * .if(If.DeploymentState, DeployState.Success)
 * .comment('deploySuccess')
 * ```
 */
export enum When {
  /**
   * **GitHub source:** `pull_request` webhook.
   * **Use with:** {@link If.Action} + {@link PrAct}, {@link If.PrState} + {@link Pr},
   * {@link If.Draft}, {@link If.Merged}, {@link If.BaseRef}, {@link If.HeadRef},
   * {@link If.Label}, {@link If.NotLabel}, {@link If.Author}.
   */
  PullRequest = 'pull_request',

  /**
   * **GitHub source:** `pull_request_review` webhook.
   * **Use with:** {@link If.Action} + {@link ReviewAct}, {@link If.ReviewState} + {@link Review},
   * {@link If.PrState}, {@link If.BaseRef}, {@link If.HeadRef}, {@link If.Label}, {@link If.NotLabel},
   * {@link If.Author}.
   */
  PullRequestReview = 'pull_request_review',

  /**
   * **GitHub source:** `workflow_run` webhook (Actions workflow finished).
   * **Use with:** {@link If.Workflow} (string), {@link If.RunEvent} + {@link RunTrigger} or `'push'`,
   * {@link If.Conclusion} + {@link RunEnd}. Steps: `.deployToJiraStatus()` or `.transitionTo()` / `.comment()`.
   */
  WorkflowRun = 'workflow_run',

  /**
   * **GitHub source:** `check_suite` webhook (all checks for a commit).
   * **Use with:** {@link If.CheckName}, {@link If.Conclusion} + {@link CheckEnd}, {@link If.Action}
   * (usually `completed`). Issue keys resolved from linked PRs / commit message like `workflow_run`.
   *
   * GitHub never triggers workflows for check suites created by GitHub Actions (or for head SHAs
   * associated with Actions), so this only sees third-party CI apps. For Actions CI use
   * {@link When.WorkflowRun}.
   */
  CheckSuite = 'check_suite',

  /**
   * **GitHub source:** `check_run` webhook (single check job).
   * **Use with:** Same as {@link When.CheckSuite} — {@link If.CheckName}, {@link If.Conclusion} + {@link CheckEnd}.
   * Same GitHub limitation: check runs from GitHub Actions never trigger workflows.
   */
  CheckRun = 'check_run',

  /**
   * **GitHub source:** `issue_comment` on an issue or PR.
   * **Use with:** {@link If.Action} (`created`, `edited`). On PR comments the engine fetches the PR
   * (needs `GITHUB_TOKEN` + `pull-requests: read`) so {@link If.BaseRef}, {@link If.HeadRef},
   * {@link If.Label}, {@link If.NotLabel} work; rules with those filters never match plain issue
   * comments. Keys extracted from comment body (+ PR title/body/branch on PR comments).
   */
  IssueComment = 'issue_comment',

  /**
   * **GitHub source:** `push` to a branch.
   * **Use with:** {@link If.HeadRef} (branch name). Keys from commit messages on the push.
   */
  Push = 'push',

  /**
   * **GitHub source:** `release` lifecycle.
   * **Use with:** {@link If.Action} + {@link ReleaseAct}, {@link If.ReleaseTag} (exact tag names; list
   * several values to match any of them).
   */
  Release = 'release',

  /**
   * **GitHub source:** merge queue (`merge_group`).
   * **Use with:** {@link If.Action}, {@link If.BaseRef}, {@link If.HeadRef} (branch names without
   * `refs/heads/`). Keys from the merge group's head commit message (and head ref).
   */
  MergeGroup = 'merge_group',

  /**
   * **GitHub source:** `deployment_status` (GitHub Environments).
   * **Use with:** {@link If.DeploymentEnvironment}, {@link If.DeploymentState} + {@link DeployState}.
   */
  DeploymentStatus = 'deployment_status',
}

/**
 * Condition field for `.if(If.…, values)` and `.ifNot(If.Draft)`.
 *
 * **GitHub source:** Each member maps to a key on {@link RuleConditions} / parsed event context
 * (see `lib/engine/matchRule.ts`).
 *
 * **Use with:** Only on {@link When} blocks where that data exists (compatibility matrix):
 *
 * | {@link If} | Typical {@link When} blocks |
 * | ---------- | --------------------------- |
 * | Action | PullRequest, PullRequestReview, CheckSuite, CheckRun, IssueComment, Release, MergeGroup, DeploymentStatus |
 * | ReviewState | PullRequestReview |
 * | Workflow | WorkflowRun |
 * | RunEvent | WorkflowRun |
 * | Conclusion | WorkflowRun, CheckSuite, CheckRun |
 * | PrState | PullRequest, PullRequestReview |
 * | Merged, Draft | PullRequest |
 * | BaseRef | PullRequest, PullRequestReview, IssueComment (PR comments), MergeGroup |
 * | HeadRef | PullRequest, PullRequestReview, IssueComment (PR comments), MergeGroup, Push |
 * | Label, NotLabel | PullRequest, PullRequestReview, IssueComment (PR comments) |
 * | Author | PullRequest, PullRequestReview |
 * | CheckName | CheckSuite, CheckRun |
 * | DeploymentEnvironment, DeploymentState | DeploymentStatus |
 * | ReleaseTag | Release |
 *
 * Jira-only filters (strings from `settings.ts`): `.ifJiraStatus('…')`, `.unlessJiraStatus('…')`.
 *
 * @example Target branch only (`main`)
 * ```ts
 * .when(When.PullRequest)
 * .if(If.Merged, true)
 * .if(If.BaseRef, 'main')
 * .transitionTo('Done')
 * ```
 *
 * @example Skip automation when label present
 * ```ts
 * .when(When.PullRequest)
 * .if(If.NotLabel, 'skip-jira')
 * .transitionTo('In Review', { via: ['Start review'] })
 * ```
 *
 * @example Quality Gate on PR runs only (ignore push-triggered workflow)
 * ```ts
 * .when(When.WorkflowRun)
 * .if(If.Workflow, 'Quality Gate')
 * .if(If.RunEvent, RunTrigger.PullRequest)
 * .if(If.Conclusion, RunEnd.Failure)
 * .comment('qualityGateFailed')
 * ```
 */
export enum If {
  /**
   * **GitHub source:** `action` on the webhook (`pull_request.action`, `release.action`, …).
   * **Values:** {@link PrAct}, {@link ReviewAct}, {@link ReleaseAct}, or raw strings (`created`, `completed`).
   */
  Action = 'action',

  /**
   * **GitHub source:** `review.state` on `pull_request_review`.
   * **Values:** {@link Review}.
   */
  ReviewState = 'reviewState',

  /**
   * **GitHub source:** `workflow_run.name` (must match `name:` in workflow YAML — **string in settings**).
   */
  Workflow = 'workflow',

  /**
   * **GitHub source:** `workflow_run.event` — what triggered the run.
   * **Values:** {@link RunTrigger} and/or strings (`push`, `schedule`, `workflow_dispatch`, …).
   */
  RunEvent = 'runEvent',

  /**
   * **GitHub source:** `conclusion` when run/check finished (`workflow_run.conclusion`, `check_suite.conclusion`, …).
   * **Values:** {@link RunEnd} or {@link CheckEnd} (same string values).
   */
  Conclusion = 'conclusion',

  /**
   * **GitHub source:** `pull_request.state`.
   * **Values:** {@link Pr}.
   */
  PrState = 'prState',

  /**
   * **GitHub source:** `pull_request.merged` (boolean).
   * **Use with:** Usually `If.Action` `closed` + {@link Pr.Closed} + `.if(If.Merged, true)`.
   */
  Merged = 'merged',

  /**
   * **GitHub source:** `pull_request.draft` (boolean). Use `.ifNot(If.Draft)` for “ready for review” paths.
   */
  Draft = 'draft',

  /**
   * **GitHub source:** `pull_request.base.ref` (target branch: `dev`, `test`, `main`, …) or
   * `merge_group.base_ref` (without `refs/heads/` prefix in rules).
   */
  BaseRef = 'baseRef',

  /**
   * **GitHub source:** `pull_request.head.ref`, push branch, or `merge_group.head_ref`
   * (without `refs/heads/` prefix in rules).
   */
  HeadRef = 'headRef',

  /**
   * **GitHub source:** PR label name — the PR must have at least one listed label.
   * **Values:** plain strings (label names in GitHub).
   */
  Label = 'label',

  /**
   * **GitHub source:** PR must **not** have this label (e.g. opt-out label).
   * **Values:** plain strings.
   */
  NotLabel = 'notLabel',

  /**
   * **GitHub source:** `pull_request.user.login`.
   * **Values:** GitHub usernames (strings).
   */
  Author = 'author',

  /**
   * **GitHub source:** `check_suite.app.name` or `check_run.name`.
   * **Values:** plain strings from third-party CI apps (e.g. `'CircleCI Checks'`). Suites and runs
   * created by GitHub Actions never trigger workflows, so `'GitHub Actions'` never matches.
   */
  CheckName = 'checkName',

  /**
   * **GitHub source:** `deployment.environment`.
   * **Values:** plain strings matching GitHub Environment names.
   */
  DeploymentEnvironment = 'deploymentEnvironment',

  /**
   * **GitHub source:** `deployment_status.state`.
   * **Values:** {@link DeployState}.
   */
  DeploymentState = 'deploymentState',

  /**
   * **GitHub source:** `release.tag_name`.
   * **Values:** plain strings (`v1.2.3`, …).
   */
  ReleaseTag = 'releaseTag',
}

/**
 * **`workflow_run.conclusion`** after the run completes.
 *
 * **GitHub source:** `workflow_run.conclusion` when `action` is `completed`.
 *
 * **Use with:** `.when(When.WorkflowRun)` + `.if(If.Conclusion, RunEnd.…)`.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_run
 *
 * @example Deploy failure comment (multiple conclusions)
 * ```ts
 * .if(If.Conclusion, RunEnd.Failure, RunEnd.Cancelled, RunEnd.TimedOut)
 * .comment('deployFailed')
 * ```
 */
export enum RunEnd {
  /** Wire value `'success'` — all jobs/steps that must pass did pass. */
  Success = 'success',
  /** Wire value `'failure'` — at least one failed job or step. */
  Failure = 'failure',
  /** Wire value `'cancelled'` — run was cancelled. */
  Cancelled = 'cancelled',
  /** Wire value `'timed_out'` — run hit a timeout. */
  TimedOut = 'timed_out',
  /** Wire value `'startup_failure'` — run could not start (e.g. invalid workflow file). */
  StartupFailure = 'startup_failure',
}

/**
 * **`pull_request` webhook `action`** — which PR activity occurred.
 *
 * **GitHub source:** `pull_request.action`.
 *
 * **Use with:** `.when(When.PullRequest)` + `.if(If.Action, PrAct.…)`.
 *
 * Subscribe to matching `types` in `jira-sync.yml` under `on.pull_request.types`.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 *
 * @example Open / update → In Review
 * ```ts
 * .if(If.Action, PrAct.Opened, PrAct.Reopened, PrAct.ReadyForReview, PrAct.Synchronize, PrAct.Edited)
 * ```
 *
 * @example Merge detection
 * ```ts
 * .if(If.Action, PrAct.Closed)
 * .if(If.PrState, Pr.Closed)
 * .if(If.Merged, true)
 * ```
 */
export enum PrAct {
  /** Wire value `'opened'` — PR created (may be draft). */
  Opened = 'opened',
  /** Wire value `'reopened'` — previously closed PR reopened. */
  Reopened = 'reopened',
  /** Wire value `'ready_for_review'` — draft marked ready. */
  ReadyForReview = 'ready_for_review',
  /** Wire value `'synchronize'` — new commits on PR branch. */
  Synchronize = 'synchronize',
  /** Wire value `'edited'` — title/body changed. */
  Edited = 'edited',
  /** Wire value `'converted_to_draft'` — marked draft again. */
  ConvertedToDraft = 'converted_to_draft',
  /** Wire value `'closed'` — closed merged or not; pair with {@link If.Merged}. */
  Closed = 'closed',
  /** Wire value `'labeled'` — label added. */
  Labeled = 'labeled',
  /** Wire value `'unlabeled'` — label removed. */
  Unlabeled = 'unlabeled',
  /** Wire value `'review_requested'` — reviewer requested. */
  ReviewRequested = 'review_requested',
  /** Wire value `'assigned'` — assignee changed. */
  Assigned = 'assigned',
  /** Wire value `'auto_merge_enabled'` — auto-merge turned on. */
  AutoMergeEnabled = 'auto_merge_enabled',
}

/**
 * **`pull_request_review` webhook `action`**.
 *
 * **GitHub source:** `pull_request_review.action`.
 *
 * **Use with:** `.when(When.PullRequestReview)` + `.if(If.Action, ReviewAct.…)`.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request_review
 *
 * @example Review submitted
 * ```ts
 * .if(If.Action, ReviewAct.Submitted)
 * .if(If.ReviewState, Review.Approved)
 * ```
 */
export enum ReviewAct {
  /** Wire value `'submitted'` — review posted (approve / request changes / comment). */
  Submitted = 'submitted',
  /** Wire value `'dismissed'` — review dismissed. */
  Dismissed = 'dismissed',
  /** Wire value `'edited'` — review body edited. */
  Edited = 'edited',
}

/**
 * **`pull_request_review.review.state`** — outcome when a review is submitted.
 *
 * **GitHub source:** `review.state` on `pull_request_review`.
 *
 * **Use with:** `.when(When.PullRequestReview)` + `.if(If.ReviewState, Review.…)`.
 *
 * @example Request changes → In Progress
 * ```ts
 * .if(If.ReviewState, Review.ChangesRequested)
 * ```
 */
export enum Review {
  /** Wire value `'changes_requested'`. */
  ChangesRequested = 'changes_requested',
  /** Wire value `'approved'`. */
  Approved = 'approved',
}

/**
 * **`pull_request.state`** — open vs closed.
 *
 * **GitHub source:** `pull_request.state`.
 *
 * **Use with:** `.if(If.PrState, Pr.Open)` or `Pr.Closed` on PR and review rules.
 *
 * @example Only act on open PRs
 * ```ts
 * .if(If.PrState, Pr.Open)
 * ```
 */
export enum Pr {
  /** Wire value `'open'`. */
  Open = 'open',
  /** Wire value `'closed'`. */
  Closed = 'closed',
}

/**
 * **`workflow_run.event`** — what triggered the Actions workflow.
 *
 * **GitHub source:** `workflow_run.event`.
 *
 * **Use with:** `.when(When.WorkflowRun)` + `.if(If.RunEvent, …)`. Enum covers common case; use
 * **plain strings** for other triggers GitHub sends.
 *
 * @see https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows
 *
 * @example PR-triggered Quality Gate only
 * ```ts
 * .if(If.RunEvent, RunTrigger.PullRequest)
 * ```
 *
 * @example Push-triggered run (string, not enum)
 * ```ts
 * .if(If.RunEvent, 'push')
 * ```
 */
export enum RunTrigger {
  /** Wire value `'pull_request'` — workflow run caused by a PR event. */
  PullRequest = 'pull_request',
}

/**
 * **`check_suite` / `check_run` conclusion** when checks complete.
 *
 * **GitHub source:** `check_suite.conclusion` / `check_run.conclusion`.
 *
 * **Use with:** `.when(When.CheckSuite | When.CheckRun)` + `.if(If.Conclusion, CheckEnd.…)`.
 * Same string set as {@link RunEnd} plus neutral/skipped/action_required/stale.
 *
 * @example Failed check suite
 * ```ts
 * .when(When.CheckSuite)
 * .if(If.Conclusion, CheckEnd.Failure)
 * ```
 */
export enum CheckEnd {
  /** Wire value `'success'`. */
  Success = 'success',
  /** Wire value `'failure'`. */
  Failure = 'failure',
  /** Wire value `'cancelled'`. */
  Cancelled = 'cancelled',
  /** Wire value `'timed_out'`. */
  TimedOut = 'timed_out',
  /** Wire value `'neutral'`. */
  Neutral = 'neutral',
  /** Wire value `'skipped'`. */
  Skipped = 'skipped',
  /** Wire value `'action_required'`. */
  ActionRequired = 'action_required',
  /** Wire value `'stale'`. */
  Stale = 'stale',
  /** Wire value `'startup_failure'`. */
  StartupFailure = 'startup_failure',
}

/**
 * **`deployment_status.state`** — result of a GitHub Environment deployment.
 *
 * **GitHub source:** `deployment_status.state`.
 *
 * **Use with:** `.when(When.DeploymentStatus)` + `.if(If.DeploymentState, DeployState.…)`.
 *
 * @example Successful deploy to an environment
 * ```ts
 * .if(If.DeploymentState, DeployState.Success)
 * ```
 */
export enum DeployState {
  /** Wire value `'success'`. */
  Success = 'success',
  /** Wire value `'failure'`. */
  Failure = 'failure',
  /** Wire value `'pending'`. */
  Pending = 'pending',
  /** Wire value `'error'`. */
  Error = 'error',
  /** Wire value `'inactive'`. */
  Inactive = 'inactive',
}

/**
 * **`release` webhook `action`**.
 *
 * **GitHub source:** `release.action`.
 *
 * **Use with:** `.when(When.Release)` + `.if(If.Action, ReleaseAct.…)`.
 *
 * @example Published release comment
 * ```ts
 * .when(When.Release)
 * .if(If.Action, ReleaseAct.Published)
 * .comment('releasePublished')
 * ```
 */
export enum ReleaseAct {
  /** Wire value `'published'`. */
  Published = 'published',
  /** Wire value `'unpublished'`. */
  Unpublished = 'unpublished',
  /** Wire value `'created'`. */
  Created = 'created',
  /** Wire value `'edited'`. */
  Edited = 'edited',
  /** Wire value `'deleted'`. */
  Deleted = 'deleted',
  /** Wire value `'prereleased'`. */
  Prereleased = 'prereleased',
  /** Wire value `'released'` (stable release after prerelease). */
  Released = 'released',
}

/**
 * **Engine constant** — conclusions every deploy “failed → comment” rule should list.
 *
 * **Not a DSL enum.** Used by static audits (`syncAudit.ts`). In `settings.ts` list the same
 * {@link RunEnd} values explicitly on `.if(If.Conclusion, …)`.
 */
export const DEPLOY_FAIL_ENDS = [
  RunEnd.Failure,
  RunEnd.Cancelled,
  RunEnd.TimedOut,
] as const;
