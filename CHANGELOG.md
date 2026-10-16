# Changelog

## 1.0.0 — 2026-10-16

First release as a GitHub Action: `uses: kgknutsson/jira-github-sync@v1` with rules in `.github/jira-sync.config.yml`.

### Added

- YAML rules file with a generated JSON Schema for editor autocomplete and validation.
- Validation with line-numbered annotations, plus warnings when the workflow's triggers, activity types, workflow names, fork guard or permissions do not match the rules.
- `validate-only` input and a local `validate` command (`npx github:kgknutsson/jira-github-sync#v1 validate`), optionally checking Jira status names.
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
