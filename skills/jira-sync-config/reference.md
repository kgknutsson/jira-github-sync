# jira-sync config — agent reference

Paths are relative to the **jira-sync package root** (this folder’s parent: `.github/workflows/jira-sync/`).

| File | Role |
| ---- | ---- |
| [settings.ts](../../settings.ts) | **Edit this** — rules, Jira strings, workflow names, messages |
| [authoring-guide.md](../../authoring-guide.md) | Human + agent examples for every `When` |
| [lib/config/syncCatalog.ts](../../lib/config/syncCatalog.ts) | GitHub enums only (`When`, `If`, `PrAct`, …) |
| [../jira-sync.yml](../../../jira-sync.yml) | Webhook triggers and permissions |
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
| `PrState`, `Merged`, `Draft`, `BaseRef`, `HeadRef`, `Label`, `NotLabel`, `Author` | PullRequest, PullRequestReview |
| `Workflow`, `RunEvent`, `Conclusion` + `RunEnd` | WorkflowRun |
| `CheckName`, `Conclusion` + `CheckEnd` | CheckSuite, CheckRun |
| `DeploymentEnvironment`, `DeploymentState` | DeploymentStatus |
| `ReleaseTag` | Release |

## YAML alignment checklist

After editing `settings.ts`:

- [ ] Every `PrAct` in `.if(If.Action, …)` → `on.pull_request.types` in `jira-sync.yml`
- [ ] Every workflow string in `.if(If.Workflow, '…')` → `on.workflow_run.workflows`
- [ ] `check_suite` rules → `on.check_suite.types` includes `completed` + `checks: read`
- [ ] `release` rules → `on.release.types` includes `published`
- [ ] `pull_request_review` → `types` includes `submitted` if used
- [ ] Runner: `node .github/workflows/jira-sync/dist/run.mjs` (no repo-root `pnpm install`)

## Verify (host repo)

| Host | Command |
| ---- | ------- |
| **This repository** | `npm run qa` (build + unit tests + verify) |
| **Vendored in another repo** | `node build.mjs` then `node dist/verify.mjs` from the package directory |
| **Jira live** | `node dist/verify.mjs --preflight` with `JIRA_*` env |

Commit **`dist/*.mjs`** after TypeScript changes under jira-sync.

## Message template ids

Every `comment('id')`, `onNoTransition`, `commentAfterSuccess`, `commentWhenSkipped` must exist in `.messages({ … })`.

Common placeholders: `{url}`, `{prUrl}`, `{baseRef}`, `{headRef}`, `{issueKey}`, `{currentStatus}`, `{targetStatus}`, `{env}`, `{workflowName}`, `{releaseTag}`.

## Side effects

```ts
extras: {
  linkGithub: 'pull_request' | 'workflow_run' | 'release',
  fields: { customfield_10042: '{prUrl}' },
}
```

See [jiraStepExtras.ts](../../lib/config/jiraStepExtras.ts).
