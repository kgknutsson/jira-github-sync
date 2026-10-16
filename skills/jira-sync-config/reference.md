# jira-sync config — agent reference

Paths are relative to the **jira-sync package root** (two levels above this file; vendored at `.github/workflows/jira-sync/`).

| File | Role |
| ---- | ---- |
| [settings.ts](../../settings.ts) | **Edit this** — rules, Jira strings, workflow names, messages |
| [authoring-guide.md](../../authoring-guide.md) | Human + agent examples for every `When` |
| [lib/config/syncCatalog.ts](../../lib/config/syncCatalog.ts) | GitHub enums only (`When`, `If`, `PrAct`, …) |
| Host repo `.github/workflows/jira-sync.yml` (template: [templates/jira-sync.workflow.yml](../../templates/jira-sync.workflow.yml)) | Webhook triggers and permissions |
| [dist/run.mjs](../../dist/run.mjs) | Actions entry (rebuild after TS changes) |

## Hard boundaries

| In `settings.ts` | In `syncCatalog.ts` / `lib/` |
| ---------------- | ---------------------------- |
| Jira status & transition **names** | `When`, `If`, `PrAct`, `RunEnd`, `CheckEnd`, … |
| Workflow **`name:`** strings | Event parsing, Jira API, engine |
| `.messages({ id: '…' })` bodies | |
| `.deploy({ … })` maps | |
| Rule chains | |

Do **not** add Jira column names to `syncCatalog.ts`. Extend the engine only when GitHub sends a value the catalog does not cover.

## Rule chain cheat sheet

```ts
config('PROJ')
  .options({ … })
  .messages({ … })
  .deploy({ … }) // if using deployToJiraStatus
  .when(When.…)
  .named('…')
  .if(If.…, …)
  .ifNot(If.Draft)
  .ifJiraStatus('…') / .unlessJiraStatus('…')
  .transitionTo('Status', { via: ['Transition'], extras: { linkGithub: 'pull_request' } })
  // or .deployToJiraStatus({ … })
  // or .comment('messageId', { extras: { … } })
  .build();
```

**Order:** first matching rule wins — specific rules **before** general ones (e.g. merge to `main` → Done before merge comment).

## `If` × `When` (quick)

| `If` | Typical `When` |
| ---- | -------------- |
| `Action` + `PrAct` / `ReviewAct` / `ReleaseAct` | PullRequest, PullRequestReview, Release, … |
| `PrState`, `BaseRef`, `HeadRef`, `Label`, `NotLabel`, `Author` | PullRequest, PullRequestReview |
| `Merged`, `Draft` | PullRequest |
| `BaseRef`, `HeadRef`, `Label`, `NotLabel` | IssueComment (PR comments only) |
| `BaseRef`, `HeadRef` | MergeGroup (`HeadRef` also Push) |
| `Workflow`, `RunEvent`, `Conclusion` + `RunEnd` | WorkflowRun |
| `CheckName`, `Conclusion` + `CheckEnd` | CheckSuite, CheckRun (third-party CI only) |
| `DeploymentEnvironment`, `DeploymentState` | DeploymentStatus |
| `ReleaseTag` | Release |

## YAML alignment checklist

After editing `settings.ts`:

- [ ] Every `PrAct` in `.if(If.Action, …)` → `on.pull_request.types` in `jira-sync.yml`
- [ ] Every workflow string in `.if(If.Workflow, '…')` → `on.workflow_run.workflows`
- [ ] `check_suite` rules → `on.check_suite.types` includes `completed` + `checks: read`
- [ ] `release` rules → `on.release.types` includes `published`
- [ ] `pull_request_review` → `types` includes `submitted` if used
- [ ] Runner: `node .github/workflows/jira-sync/dist/run.mjs` (bundled; no dependency install step in the workflow)

## Verify (host repo)

| Host | Command |
| ---- | ------- |
| **This repository** | `npm run qa` (build + typecheck + unit tests + verify) |
| **Vendored in another repo** | `node build.mjs` then `node dist/verify.mjs` (works from any directory) |
| **Jira live** | `node dist/verify.mjs --preflight` with `JIRA_*` env |

Commit **`dist/*.mjs`** after TypeScript changes under jira-sync.

## Message template ids

Every `comment('id')`, `onNoTransition`, `commentAfterSuccess`, `commentWhenSkipped` must exist in `.messages({ … })`.

Common placeholders: `{url}`, `{prUrl}`, `{baseRef}`, `{headRef}`, `{issueKey}`, `{currentStatus}`, `{targetStatus}`, `{status}`, `{env}`, `{workflowName}`, `{releaseTag}`.

## Side effects

```ts
extras: {
  linkGithub: 'pull_request' | 'workflow_run' | 'release',
  fields: { customfield_10042: '{prUrl}' },
}
```

See [jiraStepExtras.ts](../../lib/config/jiraStepExtras.ts).
