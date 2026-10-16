# Authoring Jira sync rules

How to write and extend automation in **`settings.ts`**. For secrets, Jira workflow setup, and smoke tests, see **[setup.md](setup.md)**.

**AI agents:** use skill **`jira-sync-config`** ([skills/jira-sync-config/SKILL.md](skills/jira-sync-config/SKILL.md)).

**Live reference:** [`settings.ts`](settings.ts) (this repo’s 13 sample rules).

---

## Two layers (do not mix them up)

| Layer | File | What you put there |
| ----- | ---- | ------------------ |
| **GitHub (standard)** | [`lib/config/syncCatalog.ts`](lib/config/syncCatalog.ts) | Enums only: `When`, `If`, `PrAct`, `RunEnd`, `CheckEnd`, … — same in every repo |
| **Your project** | **`settings.ts`** | Jira status/transition **strings**, workflow **`name:`** strings, comment templates, deploy maps, rule chains |

Import enums from `./lib/config`. Never add Jira column names or workflow titles to `syncCatalog.ts`.

Hover any enum in the editor — each member documents **GitHub source**, **wire value**, and **@example** fragments.

---

## Config skeleton

Every `settings.ts` follows the same top-level shape:

```ts
import { config, When, If, PrAct, /* … */ } from './lib/config';

export const builtSyncConfig = config('YOUR-PROJECT-KEY')
  .options({ /* runtime behavior */ })
  .messages({ /* template id → body with {placeholders} */ })
  .deploy({ /* only if you use .deployToJiraStatus() */ })

  .when(When.PullRequest)
  .named('Human-readable rule name')
  .if(If.Action, PrAct.Opened)
  // … more conditions …
  .transitionTo('Jira Status Name', { via: ['Transition Name'] })

  .when(When.WorkflowRun)
  .named('Another rule')
  .comment('messageTemplateId')

  .build();
```

Rebuild after TypeScript edits: **`node build.mjs`**, then **`node dist/verify.mjs`** (in this repository: `npm run qa`).

---

## `.options({ … })`

| Option | Typical value | Purpose |
| ------ | ------------- | ------- |
| `resolveKeyFromCommitMessage` | `true` | On deploy/check runs, read `PROJ-*` from head commit when no PR is linked |
| `processAllMatchingIssueKeys` | `false` | `true` = run the matched rule for **every** key found in title/body/branch |
| `failOnJiraError` | `true` | Fail the Actions job on Jira API errors (404 still skips quietly) |
| `skipMarker` | `'[skip-jira]'` or `null` | Skip when marker appears in PR/commit text (case-insensitive) |
| `noTransitionMessageId` | `'noTransition'` or `null` | Default comment when Jira has no transition to the target status |

```ts
.options({
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  failOnJiraError: true,
  skipMarker: '[skip-jira]',
  noTransitionMessageId: 'noTransition',
})
```

---

## `.messages({ … })`

Keys are **template ids** (you choose the name). Values are plain strings with **`{placeholders}`** filled at runtime.

Reference `.comment('merged')` or `commentAfterSuccess: 'deploySuccess'` by id.

### Common placeholders

| Placeholder | Typical events |
| ----------- | -------------- |
| `{url}` | PR URL, workflow run URL, release URL, comment URL; commit (checks) page for check, push, and merge group events |
| `{prUrl}` | PR URL on PR, review, and PR comment events |
| `{baseRef}` / `{headRef}` | Target / source branch |
| `{issueKey}` | e.g. `PROJ-123` |
| `{currentStatus}` | Jira column when the rule matched |
| `{targetStatus}` / `{status}` | Target column (transition / deploy steps; `{status}` on comment rules is the current column) |
| `{env}` | Deploy environment (`dev`, `test`, `prod`) or GitHub Environment on `deployment_status` |
| `{workflowName}` / `{runEvent}` | `workflow_run.name` / `workflow_run.event` |
| `{conclusion}` / `{checkName}` | Run/check conclusion, check name |
| `{releaseTag}` / `{releaseName}` | Release events |
| `{author}` / `{labels}` | PR author login, comma-separated labels (PR / review events) |

Every step kind (comment, transition, deploy) gets the same event placeholders; unknown placeholders are left as written.

```ts
.messages({
  merged: 'Pull request merged to {baseRef}: {url}',
  deploySuccess: 'Deployed to {env} via GitHub Actions: {url}',
  noTransition:
    'Could not move from "{currentStatus}" to "{targetStatus}". Run: {url}',
})
```

Every id referenced in rules (`comment('…')`, `onNoTransition`, `commentAfterSuccess`, …) must exist here. `npm run qa` / `dist/verify.mjs` validates that.

---

## `.deploy({ … })`

Required when any rule uses **`.deployToJiraStatus()`**. Maps deploy workflow jobs/branches to Jira columns.

| Field | Meaning |
| ----- | ------- |
| `jobNameRegex` | Regex matching deploy job names (capture group = env slug) |
| `branchToEnvironment` | Fallback for **push-triggered** deploy runs when no job name matches `jobNameRegex` |
| `environmentToJiraStatus` | Env slug → **exact Jira status name** |

```ts
.deploy({
  jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
  branchToEnvironment: { dev: 'dev', test: 'test', main: 'prod' },
  environmentToJiraStatus: {
    dev: 'Deployed (Dev)',
    test: 'Deployed (Test)',
    prod: 'Done',
  },
})
```

**Workflow name** in rules is a separate string — must match `name:` in your deploy workflow YAML:

```ts
.if(If.Workflow, 'Deploy')
```

---

## Rule chains

### Methods on every rule

| Method | Purpose |
| ------ | ------- |
| `.when(When.…)` | GitHub event (`pull_request`, `workflow_run`, …) |
| `.named('…')` | Log label + stable rule id slug (recommended) |
| `.if(If.…, …values)` | Match payload field (typed per event in the DSL) |
| `.ifNot(If.Draft)` | Shorthand: require non-draft PR |
| `.ifJiraStatus('In Review')` | Only when issue is already in this Jira column |
| `.unlessJiraStatus('In Review')` | Skip when issue is in this column |
| **Then one of:** | |
| `.transitionTo(status, options?)` | Move issue via named transition(s) |
| `.deployToJiraStatus(options?)` | Infer env from deploy run → map to Jira status |
| `.comment(messageId, options?)` | Post templated comment only |

### Rule order matters

The engine uses **first matching rule** in the list. Put **more specific** rules before **broader** ones.

Example: “merged to `main` → Done” must come **before** “merged → comment”, or every merge hits only the comment rule.

### Jira strings

- **Status names** and **transition names** must match Jira **exactly** (case-sensitive).
- If no transition exists from the current column, the engine posts a no-transition comment (see `onNoTransition` / `noTransitionMessageId`).

---

## `.transitionTo(…)` options

```ts
.transitionTo('In Progress', {
  via: ['Rework'],           // optional: prefer these transition names
  onNoTransition: 'qualityGateFailedNoTransition', // override default no-transition template
  commentAfterSuccess: 'qualityGateFailed',      // comment after successful move
  commentWhenSkipped: 'deploySuccessAlreadyOnStatus', // already on target status
  extras: { linkGithub: 'pull_request' },
})
```

---

## `.deployToJiraStatus(…)` options

```ts
.deployToJiraStatus({
  commentAfterSuccess: 'deploySuccess',
  commentWhenSkipped: 'deploySuccessAlreadyOnStatus',
  onNoTransition: 'noTransition',
  extras: { linkGithub: 'workflow_run' },
})
```

---

## `.comment(…)` and `extras`

```ts
.comment('merged', {
  extras: {
    linkGithub: 'pull_request', // 'pull_request' | 'workflow_run' | 'release'
    fields: { customfield_10042: '{prUrl}' }, // optional Jira fields
  },
})
```

See [`lib/config/jiraStepExtras.ts`](lib/config/jiraStepExtras.ts) for `linkGithub` kinds and field templates.

---

## Examples by event (`When`)

Each block is a **copy-paste starting point**. Adjust Jira/workflow strings for your project.

### `When.PullRequest`

**YAML:** add matching `types` under `on.pull_request.types` in your `.github/workflows/jira-sync.yml` (start from [templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml)).

```ts
// Ready for review → In Review (skip label + non-draft)
.when(When.PullRequest)
.named('PR ready → In Review')
.if(If.Action, PrAct.Opened, PrAct.Reopened, PrAct.ReadyForReview, PrAct.Synchronize, PrAct.Edited)
.if(If.PrState, Pr.Open)
.ifNot(If.Draft)
.if(If.NotLabel, 'skip-jira')
.transitionTo('In Review', { via: ['Start review'], extras: { linkGithub: 'pull_request' } })

// Opened as draft
.when(When.PullRequest)
.named('PR opened as draft → In Progress')
.if(If.Action, PrAct.Opened)
.if(If.PrState, Pr.Open)
.if(If.Draft, true)
.transitionTo('In Progress', { via: ['Rework'] })

// Converted to draft
.when(When.PullRequest)
.if(If.Action, PrAct.ConvertedToDraft)
.if(If.PrState, Pr.Open)
.transitionTo('In Progress', { via: ['Rework'] })

// Merged to main → Done (before generic merge comment rule)
.when(When.PullRequest)
.if(If.Action, PrAct.Closed)
.if(If.PrState, Pr.Closed)
.if(If.Merged, true)
.if(If.BaseRef, 'main')
.transitionTo('Done', { extras: { linkGithub: 'pull_request' } })

// Any merge → comment
.when(When.PullRequest)
.if(If.Action, PrAct.Closed)
.if(If.PrState, Pr.Closed)
.if(If.Merged, true)
.comment('merged', { extras: { linkGithub: 'pull_request' } })
```

**Useful `If` on PRs:** `BaseRef`, `HeadRef`, `Label`, `NotLabel`, `Author`, `Merged`, `Draft`, `PrState`, `Action` + `PrAct`.

---

### `When.PullRequestReview`

**YAML:** `on.pull_request_review.types` must include `submitted` (and any others you match).

```ts
.when(When.PullRequestReview)
.named('Changes requested → In Progress')
.if(If.Action, ReviewAct.Submitted)
.if(If.PrState, Pr.Open)
.if(If.ReviewState, Review.ChangesRequested)
.transitionTo('In Progress', { via: ['Request changes'] })

.when(When.PullRequestReview)
.named('PR approved → comment')
.if(If.Action, ReviewAct.Submitted)
.if(If.PrState, Pr.Open)
.if(If.ReviewState, Review.Approved)
.comment('prApproved')
```

---

### `When.WorkflowRun`

**YAML:** `on.workflow_run.workflows` must list exact workflow **`name:`** strings; `types: [completed]`.

```ts
// Deploy success → column from .deploy() map
.when(When.WorkflowRun)
.if(If.Workflow, 'Deploy')
.if(If.Conclusion, RunEnd.Success)
.deployToJiraStatus({
  commentAfterSuccess: 'deploySuccess',
  commentWhenSkipped: 'deploySuccessAlreadyOnStatus',
  extras: { linkGithub: 'workflow_run' },
})

// Deploy failed / cancelled / timed out
.when(When.WorkflowRun)
.if(If.Workflow, 'Deploy')
.if(If.Conclusion, RunEnd.Failure, RunEnd.Cancelled, RunEnd.TimedOut)
.comment('deployFailed')

// Quality Gate — PR-triggered runs only (avoids nested push/workflow_call noise)
.when(When.WorkflowRun)
.if(If.Workflow, 'Quality Gate')
.if(If.RunEvent, RunTrigger.PullRequest)
.if(If.Conclusion, RunEnd.Failure)
.ifJiraStatus('In Review')
.transitionTo('In Progress', {
  via: ['Rework'],
  onNoTransition: 'qualityGateFailedNoTransition',
  commentAfterSuccess: 'qualityGateFailed',
})

.when(When.WorkflowRun)
.if(If.Workflow, 'Quality Gate')
.if(If.RunEvent, RunTrigger.PullRequest)
.if(If.Conclusion, RunEnd.Failure)
.unlessJiraStatus('In Review')
.comment('qualityGateFailed')

.when(When.WorkflowRun)
.if(If.Workflow, 'Quality Gate')
.if(If.RunEvent, RunTrigger.PullRequest)
.if(If.Conclusion, RunEnd.Success)
.comment('qualityGateSuccess')
```

**Tip:** `RunTrigger.PullRequest` is an enum; other `workflow_run.event` values can be plain strings, e.g. `.if(If.RunEvent, 'push')`.

---

### `When.CheckSuite` / `When.CheckRun`

**YAML:** `on.check_suite.types: [completed]` (and/or `check_run`); workflow needs **`checks: read`**.

> **GitHub limitation:** these events never trigger workflows for check suites/runs created by **GitHub Actions** (or for head SHAs associated with Actions), so they only see **third-party** CI apps. For Actions-based CI, use `When.WorkflowRun` with the workflow `name:` instead.

```ts
.when(When.CheckSuite)
.named('External CI failed (in review) → In Progress')
.if(If.CheckName, 'CircleCI Checks')
.if(If.Conclusion, CheckEnd.Failure)
.ifJiraStatus('In Review')
.transitionTo('In Progress', {
  via: ['Rework'],
  onNoTransition: 'qualityGateFailedNoTransition',
  commentAfterSuccess: 'qualityGateFailed',
})
```

Use the same pattern on `When.CheckRun` for a single check name.

---

### `When.Release`

**YAML:** `on.release.types: [published]`.

```ts
.when(When.Release)
.named('Release published → comment')
.if(If.Action, ReleaseAct.Published)
.comment('releasePublished', { extras: { linkGithub: 'release' } })
```

Optional: `.if(If.ReleaseTag, 'v1.0.0', 'v2.0.0')` to filter tags.

---

### `When.IssueComment`

**YAML:** `on.issue_comment.types: [created, edited]`.

```ts
.when(When.IssueComment)
.named('Bot command in comment')
.if(If.Action, 'created')
// On PR comments you can filter branches/labels (never matches plain issue comments):
// .if(If.BaseRef, 'main')
.comment('myTemplate')
```

Issue keys are parsed from the comment body, plus the PR title, body, and branch on PR comments. GitHub's `issue_comment` payload has no PR details, so the engine fetches the PR (needs `GITHUB_TOKEN` and `pull-requests: read`); comments on fork PRs are skipped.

> **Public repositories:** anyone can comment, so any `IssueComment` rule can be triggered by outsiders for any issue key they type. Prefer comment-only rules there, or keep `issue_comment` out of the workflow triggers.

---

### `When.Push`

**YAML:** `on.push.branches: [dev, main, …]`.

```ts
.when(When.Push)
.named('Push to main with key in commits')
.if(If.HeadRef, 'main')
.comment('pushNote')
```

Keys come from commit messages on the push.

---

### `When.DeploymentStatus`

**YAML:** `on.deployment_status:` (no types filter required).

```ts
.when(When.DeploymentStatus)
.named('Production deploy success')
.if(If.DeploymentEnvironment, 'production')
.if(If.DeploymentState, DeployState.Success)
.comment('deploySuccess')
```

Import `DeployState` from `./lib/config`.

---

### `When.MergeGroup`

**YAML:** `on.merge_group.types: [checks_requested, destroyed]`.

```ts
.when(When.MergeGroup)
.if(If.Action, 'checks_requested')
.if(If.BaseRef, 'main')
.comment('mergeQueueNote')
```

Branch filters use names without `refs/heads/`. Keys come from the merge group's head commit message (which carries the queued PR titles).

---

## Issue keys and opt-out

| Mechanism | How |
| --------- | --- |
| **Key format** | `{PROJECT_KEY}-\d+` (e.g. `PROJ-123`, case-insensitive, separated by any non-alphanumeric character such as `/`, `-`, `_`) in PR title, body, branch, and/or commit message |
| **Resolution order (PR)** | title → body → branch |
| **Resolution order (workflow run)** | linked PR → commit message → branch |
| **Resolution order (merge group)** | head commit message → head ref |
| **Text skip** | `skipMarker` in title/body/branch/commit |
| **Label skip** | `.if(If.NotLabel, 'skip-jira')` on PR rules |
| **Fork PRs** | Skipped (no cross-repo transitions) |

---

## Keep `jira-sync.yml` in sync

When you add rules:

1. **`pull_request.types`** — include every `PrAct` you `.if(If.Action, …)` on.
2. **`workflow_run.workflows`** — include every string passed to `.if(If.Workflow, '…')`.
3. **New `When.*`** — add the corresponding `on:` trigger (see [templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml) for a broad starter set).
4. **Permissions** — `pull-requests: read`, `checks: read` for PR/commit and check events.

Static audits in `lib/audit/syncAudit.ts` (via `dist/verify.mjs`) catch many drifts automatically.

---

## Verify loop

After changing **`lib/`** engine code or **`settings.ts`**, rebuild and commit **`dist/`**, then verify:

```bash
node build.mjs
node dist/verify.mjs              # settings.ts vs jira-sync.yml (works from any directory)

# Optional live Jira + status name check (needs JIRA_* env)
node dist/verify.mjs --preflight
```

In this repository, `npm run qa` runs the same checks plus type-checking and the unit tests, which assert the bundled sample rules.

---

## Quick reference: `If` × `When`

| `If` | Use on |
| ---- | ------ |
| `Action` | PullRequest, PullRequestReview, CheckSuite, CheckRun, IssueComment, Release, MergeGroup, DeploymentStatus |
| `ReviewState` | PullRequestReview |
| `Workflow`, `RunEvent`, `Conclusion` | WorkflowRun |
| `PrState` | PullRequest, PullRequestReview |
| `Merged`, `Draft` | PullRequest |
| `BaseRef` | PullRequest, PullRequestReview, IssueComment (PR comments), MergeGroup |
| `HeadRef` | PullRequest, PullRequestReview, IssueComment (PR comments), MergeGroup, Push |
| `Label`, `NotLabel` | PullRequest, PullRequestReview, IssueComment (PR comments) |
| `Author` | PullRequest, PullRequestReview |
| `CheckName`, `Conclusion` | CheckSuite, CheckRun |
| `DeploymentEnvironment`, `DeploymentState` | DeploymentStatus |
| `ReleaseTag` | Release |

Full enum docs: **[`syncCatalog.ts`](lib/config/syncCatalog.ts)**.

---

## Adding new GitHub enum values

Only when GitHub sends a value the engine does not yet expose:

1. Add to the appropriate enum in **`syncCatalog.ts`** (with JSDoc + wire value).
2. If needed, extend parsing in **`lib/adapters/github/parseEvent.ts`** and matching in **`lib/engine/matchRule.ts`**.
3. Add DSL overloads in **`lib/config/dsl.ts`** if TypeScript should type-check new `.if()` combinations.
4. Rebuild **`dist/`**, extend tests under **`tests/`**.

For most repos, editing **`settings.ts`** and workflow YAML is enough.
