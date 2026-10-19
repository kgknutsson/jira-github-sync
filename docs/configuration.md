# Rules file reference

The action reads its rules from **`.github/jira-sync.config.yml`** in your repository (change the path with the `config-file` input). The file is YAML; JSON works too.

Start from [templates/jira-sync.config.yml](../templates/jira-sync.config.yml). Keep its first line so VS Code / Cursor (with the YAML extension) autocomplete keys and flag mistakes while you type:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/kgknutsson/jira-github-sync/v1/jira-sync.config.schema.json
```

Every run validates the file and fails with an annotation on the offending line when something is wrong, for example `rule "PR merged": "merged" is not available on workflow_run rules`.

---

## Top-level keys

| Key | Required | Purpose |
| --- | -------- | ------- |
| `projectKey` | yes | Jira project key in capitals; issue keys look like `PROJ-123` |
| `options` | no | Runtime behavior (below) |
| `messages` | no | Comment templates by id |
| `deploy` | for deploy rules | Maps deploy runs to Jira statuses |
| `rules` | yes | The rules, checked top to bottom |

## `options`

| Option | Default | Purpose |
| ------ | ------- | ------- |
| `resolveKeyFromCommitMessage` | `true` | On `workflow_run`, check and deployment events, also read issue keys from the head commit message |
| `processAllMatchingIssueKeys` | `false` | Apply the matched rule to every issue key found, not just the first |
| `failOnJiraError` | `true` | Fail the job on Jira API errors (issues that do not exist are always skipped) |
| `skipMarker` | `'[skip-jira]'` | Skip events whose PR, commit or comment text contains this (case-insensitive); `null` disables. Keep the quotes: unquoted `[skip-jira]` is a YAML list |
| `noTransitionMessageId` | `noTransition` if that message exists | Message posted when Jira has no transition to a rule's target status; `null` posts nothing (only if the rule has `commentOnIssue: true`) |

## Per-rule comments (`commentOnIssue`)

Comments are **opt-in per rule**, not global:

| Rule type | Default | To comment |
| --------- | ------- | ---------- |
| `comment:` only | Posts the message | Omit `commentOnIssue`, or set `commentOnIssue: false` to skip |
| `transitionTo` / `deployToJiraStatus` | **Silent** (status only) | Set `commentOnIssue: true` and use `commentAfterSuccess`, `commentWhenSkipped`, or `onNoTransition` |

```yaml
  - name: Deploy failed → comment
    when: workflow_run
    if: { workflow: Deploy, conclusion: failure }
    comment: deployFailed

  - name: Deploy success → status only
    when: workflow_run
    if: { workflow: Deploy, conclusion: success }
    deployToJiraStatus: true

  - name: Quality gate failed
    when: workflow_run
    if: { workflow: Quality Gate, conclusion: failure }
    transitionTo: In Progress
    commentOnIssue: true
    commentAfterSuccess: qualityGateFailed
```

## `messages`

Templates by id; rules refer to them with `comment`, `commentAfterSuccess`, `commentWhenSkipped` and `onNoTransition`. `{placeholders}` are filled in per event; unknown ones stay as written and are reported as warnings.

```yaml
messages:
  merged: 'Pull request merged to {baseRef}: {url}'
  noTransition: 'Could not move this issue from "{currentStatus}" to "{targetStatus}". Run: {url}'
```

| Placeholder | Value |
| ----------- | ----- |
| `{issueKey}` | Jira issue key, e.g. `PROJ-123` |
| `{url}` | Main link for the event: PR, workflow run, release, comment, or the commit / checks page for check, push and merge group events; the environment URL for `deployment_status` |
| `{prUrl}` | Pull request URL (`pull_request`, `pull_request_review`, PR comments) |
| `{baseRef}` / `{headRef}` | Target / source branch (`{headRef}` is the pushed branch on `push`) |
| `{currentStatus}` | Jira status when the rule matched |
| `{targetStatus}` | Status a transition or deploy step moves to |
| `{status}` | Target status in transition and deploy comments; the current status in comment rules |
| `{env}` | Deploy environment (deploy steps) or GitHub Environment (`deployment_status`) |
| `{workflowName}` / `{runEvent}` | Workflow name and what triggered the run (`workflow_run`) |
| `{conclusion}` | Run or check conclusion |
| `{checkName}` | Check name (`check_suite`, `check_run`) |
| `{author}` / `{labels}` | PR author login, comma-separated PR labels |
| `{releaseTag}` / `{releaseName}` | Release tag and name |
| `{ref}` | Pushed ref (`push`) |
| `{deploymentState}` | Deployment state (`deployment_status`) |

## `deploy`

Needed when a rule uses `deployToJiraStatus`. The action works out which environment a finished deploy run targeted, then moves the issue to the status mapped for it.

```yaml
deploy:
  jobNameRegex: 'Build and Deploy \((dev|test|prod)\)'
  branchToEnvironment: { dev: dev, test: test, main: prod }
  environmentToJiraStatus:
    dev: Deployed (Dev)
    test: Deployed (Test)
    prod: Done
```

| Field | Purpose |
| ----- | ------- |
| `jobNameRegex` | Regex on the run's job names; capture group 1 is the environment. Needs `actions: read` |
| `branchToEnvironment` | Fallback for **push-triggered** runs when no job name matches: branch → environment |
| `environmentToJiraStatus` | Environment → exact Jira status name |

## `rules`

Rules are checked **top to bottom and the first match runs**, so put specific rules above general ones (for example "merged to `main` → Done" above "merged → comment").

```yaml
rules:
  - name: Quality gate failed (in review) → In Progress
    when: workflow_run
    if: { workflow: Quality Gate, runEvent: pull_request, conclusion: failure }
    ifJiraStatus: In Review
    transitionTo: In Progress
    via: Rework
    onNoTransition: qualityGateFailedNoTransition
    commentAfterSuccess: qualityGateFailed
```

| Key | Purpose |
| --- | ------- |
| `name` | Unique label, shown in the job log |
| `when` | GitHub event (see [Events and conditions](#events-and-conditions)) |
| `if` | Conditions on the event; all must match. A value can be a list, meaning "any of" |
| `ifJiraStatus` / `unlessJiraStatus` | Only when / unless the issue is currently in this Jira status |
| **one action** | |
| `transitionTo` | Move the issue to this exact Jira status |
| `deployToJiraStatus: true` | `workflow_run` only: move the issue to the status mapped for the deployed environment |
| `comment` | Post this message |
| **options** | |
| `via` | `transitionTo` only: transition names to prefer when several lead to the status |
| `onNoTransition` | Message when no transition leads to the status (overrides `noTransitionMessageId`) |
| `commentAfterSuccess` | Message after a successful transition |
| `commentWhenSkipped` | Message when the issue is already in the status |
| `linkGithub` | Add (or update) a Jira web link: `pull_request`, `workflow_run` or `release` |
| `fields` | Set Jira fields after the step: field id → value template, e.g. `customfield_10042: '{prUrl}'` |

Jira status and transition names must match Jira **exactly** (case-sensitive). A transition step does nothing when the issue is already in the target status. Otherwise it uses a `via` transition if one leads to the status, then any transition that does, and posts the no-transition message when none does.

---

## Events and conditions

| `when` | Fires on | `action` values |
| ------ | -------- | --------------- |
| `pull_request` | PR opened, updated, marked ready, converted to draft, closed, … | `opened`, `reopened`, `ready_for_review`, `synchronize`, `edited`, `converted_to_draft`, `closed`, `labeled`, `unlabeled`, `review_requested`, `assigned`, … (every GitHub PR action) |
| `pull_request_review` | Review submitted, edited or dismissed | `submitted`, `edited`, `dismissed` |
| `workflow_run` | An Actions workflow finished | none (only completed runs are handled) |
| `check_suite` / `check_run` | Third-party CI checks completed (see below) | `completed` |
| `issue_comment` | Comment on an issue or PR | `created`, `edited`, `deleted` |
| `push` | Commits pushed to a branch | none |
| `release` | Release lifecycle | `published`, `unpublished`, `created`, `edited`, `deleted`, `prereleased`, `released` |
| `merge_group` | Merge queue | `checks_requested`, `destroyed` |
| `deployment_status` | Deployment status for a GitHub Environment | `created` |

| Condition | Events | Values |
| --------- | ------ | ------ |
| `action` | all but `workflow_run`, `push` | per event, above |
| `prState` | `pull_request`, `pull_request_review` | `open`, `closed` |
| `merged` | `pull_request` | `true` / `false` |
| `draft` | `pull_request` | `true` / `false` (`false` = ready for review) |
| `reviewState` | `pull_request_review` | `approved`, `changes_requested`, `commented`, `dismissed` |
| `baseRef` | `pull_request`, `pull_request_review`, `issue_comment` (PR comments), `merge_group` | branch name |
| `headRef` | `pull_request`, `pull_request_review`, `issue_comment` (PR comments), `merge_group`, `push` | branch name |
| `label` / `notLabel` | `pull_request`, `pull_request_review`, `issue_comment` (PR comments) | PR has any / none of these labels |
| `author` | `pull_request`, `pull_request_review` | GitHub login of the PR author |
| `workflow` | `workflow_run` | workflow `name:` |
| `runEvent` | `workflow_run` | what triggered the run: `pull_request`, `push`, `workflow_dispatch`, … |
| `conclusion` | `workflow_run`, `check_suite`, `check_run` | `success`, `failure`, `cancelled`, `timed_out`, `action_required`, `neutral`, `skipped`, `stale`, `startup_failure` |
| `checkName` | `check_suite`, `check_run` | check suite app name or check run name |
| `deploymentEnvironment` | `deployment_status` | GitHub Environment name |
| `deploymentState` | `deployment_status` | `success`, `failure`, `error`, `pending`, `inactive`, `in_progress`, `queued` |
| `releaseTag` | `release` | tag name (quote numbers: `'1.10'`) |

Branch names never include `refs/heads/`.

---

## Examples by event

Each `when` also needs a matching trigger in the workflow file; the action warns when one is missing.

### `pull_request`

```yaml
  - name: PR ready → In Review
    when: pull_request
    if:
      action: [opened, reopened, ready_for_review, synchronize, edited]
      prState: open
      draft: false
      notLabel: skip-jira
    transitionTo: In Review
    linkGithub: pull_request

  - name: PR merged to main → Done
    when: pull_request
    if: { action: closed, prState: closed, merged: true, baseRef: main }
    transitionTo: Done
```

Workflow: list every `action` you match under `on.pull_request.types`. Without `types`, GitHub only sends `opened`, `synchronize` and `reopened`.

### `pull_request_review`

```yaml
  - name: Changes requested → In Progress
    when: pull_request_review
    if: { action: submitted, prState: open, reviewState: changes_requested }
    transitionTo: In Progress
```

Reviews have no branch filter in the workflow file; filter with `baseRef` or a job-level `if:` (the template does the latter).

### `workflow_run`

```yaml
  - name: Deploy success → environment status
    when: workflow_run
    if: { workflow: Deploy, conclusion: success }
    deployToJiraStatus: true
    commentAfterSuccess: deploySuccess
    linkGithub: workflow_run

  - name: Deploy failed → comment
    when: workflow_run
    if: { workflow: Deploy, conclusion: [failure, cancelled, timed_out] }
    comment: deployFailed
```

Workflow: list each `workflow` name under `on.workflow_run.workflows` with `types: [completed]`. GitHub only delivers `workflow_run` to workflow files on the **default branch**. Use `runEvent: pull_request` to ignore push-triggered runs of a CI workflow.

### `check_suite` / `check_run`

GitHub never triggers workflows for checks created by GitHub Actions (or for commits that have Actions checks), so these only see **third-party** CI apps. For Actions CI use `workflow_run`.

```yaml
  - name: External CI failed (in review) → In Progress
    when: check_suite
    if: { checkName: CircleCI Checks, conclusion: failure }
    ifJiraStatus: In Review
    transitionTo: In Progress
```

### `issue_comment`

```yaml
  - name: Comment on a PR to main
    when: issue_comment
    if: { action: created, baseRef: main }
    comment: commentNote
```

GitHub's comment event has no PR details, so the action fetches the PR (needs `pull-requests: read`). `baseRef`, `headRef` and `label` never match comments on plain issues. Comments on fork PRs are skipped.

> **Public repositories:** anyone can comment, so outsiders can trigger `issue_comment` rules for any issue key they type. Avoid transitions there, or leave `issue_comment` out of the workflow triggers.

### `push`

```yaml
  - name: Pushed to main
    when: push
    if: { headRef: main }
    comment: pushNote
```

Issue keys come from the commit messages in the push (GitHub includes up to 20) and the branch name.

### `release`

```yaml
  - name: Release published → comment
    when: release
    if: { action: published }
    comment: releasePublished
    linkGithub: release
```

### `merge_group`

```yaml
  - name: Queued for main
    when: merge_group
    if: { action: checks_requested, baseRef: main }
    comment: mergeQueueNote
```

Issue keys come from the merge group's head commit message, which carries the queued PR titles.

### `deployment_status`

```yaml
  - name: Production deploy succeeded
    when: deployment_status
    if: { deploymentEnvironment: production, deploymentState: success }
    comment: deploySuccess
```

---

## Issue keys and opt-out

Keys look like `PROJ-123`. Matching is case-insensitive, and a key may sit next to any non-alphanumeric character (`feature/PROJ-1`, `PROJ-1_fix`). By default only the first key found is used (`processAllMatchingIssueKeys`).

| Event | Where keys are read, in order |
| ----- | ----------------------------- |
| `pull_request`, `pull_request_review` | PR title → body → branch |
| `workflow_run`, `check_suite`, `check_run`, `deployment_status` | linked PR (title, body, branch) → head commit message → branch |
| `issue_comment` | comment, plus the PR title, body and branch on PR comments |
| `push` | commit messages → branch |
| `release` | release name → tag |
| `merge_group` | head commit message → head branch |

Opt out per change with the `skipMarker` text (default `[skip-jira]`) or a label matched by `notLabel`. Pull requests from forks, comments on them, and workflow runs or checks linked to them are always skipped.

## What the action checks in your workflow

Before syncing, the action compares the workflow file that runs it with your rules and adds a warning annotation when:

- a rule's event is not a trigger, or the trigger's `types` miss an `action` a rule matches;
- a `workflow` name is missing from `on.workflow_run.workflows`;
- `workflow_run` rules exist but the job does not skip runs from forks;
- the job's permissions lack `pull-requests: read` (PR lookups) or `actions: read` (deploy job names).

It also fails when a `deployToJiraStatus` rule has no usable `deploy` map. Run it with `validate-only: true`, or locally:

```bash
npx -y https://github.com/kgknutsson/jira-github-sync/archive/refs/tags/v1.0.5.tar.gz validate .github/jira-sync.config.yml --workflow .github/workflows/jira-sync.yml
# add --preflight with JIRA_BASE_URL, JIRA_USER_EMAIL and JIRA_API_TOKEN set to check status names in Jira
```
