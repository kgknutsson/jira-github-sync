# Changelog

## 1.0.6 — 2026-10-19

### Fixed

- CI: run Vitest test files serially so `dist.test` and `action-e2e` do not race on `node build.mjs` (intermittent empty output on Node 20).

## 1.0.5 — 2026-10-19

### Added

- Per-rule `commentOnIssue`: transition/deploy rules comment only when `commentOnIssue: true`; `comment:` rules post by default (`commentOnIssue: false` skips).

### Fixed

- Remote links: skip the Jira API when the issue already has the same URL. Repeated `POST` remotelink calls (even with `globalId`) still appear as **RemoteWorkItemLink updated** in the activity feed and clutter tickets.

## 1.0.4 — 2026-10-16

### Fixed

- Results of `workflow_run`s triggered by a pull request are ignored when the PR has newer commits. Older runs are not cancelled, so a failed Quality Gate for an earlier commit could finish after the latest commit's run passed and move the issue back to In Progress. Runs from pushes (deploys) are not affected.

## 1.0.3 — 2026-10-16

### Fixed

- Statuses work whatever language the Jira account uses. Jira returns status names in the account's language (e.g. "In Progress" as 正在进行), so rules, `ifJiraStatus` conditions and the deploy map never matched for a non-English account. The action now reads the untranslated name of each status, and comments show those names. The preflight accepts both.
- Workflow template: PR events, reviews and workflow runs for the same PR share one concurrency group with `queue: max`. Before, a slow sync for a push could finish after a "changes requested" review and move the issue back to In Review, and GitHub's default single pending slot could drop an event.

## 1.0.2 — 2026-10-16

### Fixed

- A `404` for an issue is a warning that names the cause. Jira Cloud also answers `404` when the login fails or the account cannot browse the project, so the action asks `/rest/api/3/myself` and reports a rejected login, a `JIRA_BASE_URL` that is not a Jira site, or a missing issue or missing project access.
- A `JIRA_BASE_URL` pointing at a page on `*.atlassian.net`, such as a board URL copied from the browser, uses the site root.

## 1.0.1 — 2026-10-16

### Fixed

- Missing Jira credentials are a warning annotation instead of an easy-to-miss log line. The warning names the empty secrets and the issue that was not updated, and only appears when an issue would have changed, so PRs without an issue key (e.g. Dependabot) stay quiet. `validate-only` and `--preflight` warn the same way.
- Credentials are trimmed, so a secret pasted with a trailing newline no longer fails with `401`.

### Docs

- Keeping the Jira secrets on an environment: `environment: { name, deployment: false }` on the job.

## 1.0.0 — 2026-10-16

First release as a GitHub Action: `uses: kgknutsson/jira-github-sync@v1` with rules in `.github/jira-sync.config.yml`.

### Added

- YAML rules file with a generated JSON Schema for editor autocomplete and validation.
- Validation with line-numbered annotations, plus warnings when the workflow's triggers, activity types, workflow names, fork guard or permissions do not match the rules.
- `validate-only` input and a local `validate` command (run with `npx` from the release archive), optionally checking Jira status names.
- Merge-queue issue keys from the head commit message; `startup_failure` conclusions.

### Fixed

- Comments on check, push, release, merge-queue and deployment events no longer contain a literal `{url}`; every placeholder works for every step.
- Issue-comment rules: the PR is fetched, so branch and label filters, PR-title keys and the fork check work.
- `check_run` branch, merge-queue branch filters, PRs from deleted forks, and empty release names.
- Jira web links are updated instead of duplicated.
- Issue keys next to underscores (`PROJ-12_fix`) are found.
- The workflow template no longer cancels in-flight runs (which could drop the `opened` transition) and no longer lumps all check and comment events into one queue.

### Removed

- The vendored mode: `settings.ts`, the TypeScript DSL, `dist/run.mjs` and `dist/verify.mjs`.
- The sample check-suite rule, which GitHub never triggers for GitHub Actions checks.
