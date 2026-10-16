---
name: jira-sync-config
description: >-
  Writes and reviews rules for the kgknutsson/jira-github-sync GitHub Action: the YAML rules
  file (.github/jira-sync.config.yml) and the workflow that runs it
  (.github/workflows/jira-sync.yml). Use when adding or changing Jira automation driven by
  GitHub events (pull requests, reviews, CI and deploy workflow runs, releases), setting the
  action up in a repository, or debugging why a Jira issue did not move.
disable-model-invocation: true
---

# Jira sync rules

Produce valid, review-ready rules for jira-github-sync. Full reference: [docs/configuration.md](https://github.com/kgknutsson/jira-github-sync/blob/main/docs/configuration.md). Checklist: [reference.md](./reference.md).

Do **not** use this skill for implementing Jira tickets (coding work), only for sync configuration.

## Workflow (in order)

### 1. Collect the repository's strings

Ask when they are missing; never guess Jira spelling.

| Input | Example |
| ----- | ------- |
| Jira project key | `PROJ` |
| Status names (exact, case-sensitive) | `In Review`, `Done`, `Deployed (Test)` |
| Transition names (optional, for `via`) | `Start review` |
| Workflow `name:` values | `Quality Gate`, `Deploy` |
| Branches | `dev`, `test`, `main` |

### 2. Plan the rules

For each intent decide:

1. **Event:** `when` (`pull_request`, `pull_request_review`, `workflow_run`, `release`, …)
2. **Conditions:** `if` (GitHub side) and `ifJiraStatus` / `unlessJiraStatus` (Jira side)
3. **One action:** `transitionTo`, `deployToJiraStatus: true` (workflow_run only) or `comment`
4. **Order:** the first matching rule wins, so specific rules go above general ones

### 3. Edit `.github/jira-sync.config.yml`

Keep the `# yaml-language-server: $schema=…` first line. Pattern:

```yaml
projectKey: PROJ
messages:
  merged: 'Pull request merged to {baseRef}: {url}'
rules:
  - name: PR ready → In Review
    when: pull_request
    if: { action: [opened, reopened, ready_for_review, synchronize], prState: open, draft: false }
    transitionTo: In Review
    linkGithub: pull_request
```

Quality bar:

- Every message id used by `comment`, `commentAfterSuccess`, `commentWhenSkipped` or `onNoTransition` exists under `messages`.
- PR transition rules require `prState: open` (or `merged: true`); review rules require `prState: open`.
- CI rules on PRs use `runEvent: pull_request` so push-triggered runs are ignored.
- Deploy failure comments list `conclusion: [failure, cancelled, timed_out]`.
- Opt-outs use `skipMarker` (quoted: `'[skip-jira]'`) or a `notLabel` condition.

### 4. Align `.github/workflows/jira-sync.yml`

| Rules use | Workflow needs |
| --------- | -------------- |
| `when: X` | an `on.X` trigger |
| `if: { action: … }` | each value under `on.X.types` (`pull_request` defaults to only opened / synchronize / reopened) |
| `if: { workflow: Name }` | `Name` under `on.workflow_run.workflows`, `types: [completed]` |
| `workflow_run`, `issue_comment` or check events | `pull-requests: read` |
| `deployToJiraStatus` | `actions: read` and a `deploy:` map |

Start from [templates/jira-sync.workflow.yml](https://github.com/kgknutsson/jira-github-sync/blob/main/templates/jira-sync.workflow.yml). The workflow must be on the default branch for `workflow_run`.

### 5. Validate

```bash
npx -y https://github.com/kgknutsson/jira-github-sync/archive/refs/tags/v1.0.3.tar.gz validate .github/jira-sync.config.yml --workflow .github/workflows/jira-sync.yml
```

Add `--preflight` (with `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN` set) to confirm every status exists in Jira. Fix all errors and warnings.

## Common mistakes

| Mistake | Fix |
| ------- | --- |
| Broad rule above a specific one | Reorder: e.g. "merged to main → Done" above "merged → comment" |
| `check_suite` / `check_run` rule for GitHub Actions CI | Never fires; use `workflow_run` with the workflow name |
| Unquoted `[skip-jira]`, or numbers like `1.10` | Quote them |
| Action matched in a rule but not in `types` | Add it to the workflow trigger |
| Transition on PR events without `prState: open` | Edits to closed PRs would move the issue |
| `issue_comment` transitions on a public repo | Anyone can comment; prefer comments or drop the trigger |

## Output

When done, report:

1. Rules added or changed (name and Jira effect)
2. Workflow changes
3. The validate command you ran and its result
4. Manual follow-up (Jira transitions or statuses to create, secrets, labels)
