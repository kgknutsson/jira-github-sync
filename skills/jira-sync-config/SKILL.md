---
name: jira-sync-config
description: >-
  Authors GitHub–Jira sync rules in settings.ts for the bundled jira-sync engine:
  options, messages, deploy maps, When/If DSL, YAML trigger alignment, dist rebuild,
  and verify. Use when adding or changing Jira automation, editing
  .github/workflows/jira-sync/settings.ts, jira-sync.yml, or copying jira-sync to
  another repo.
disable-model-invocation: true
---

# Jira sync config authoring

Teach the agent to produce **valid, review-ready** jira-sync configuration. This skill lives inside the portable package so it copies with `.github/workflows/jira-sync/`.

**Read first:** [authoring-guide.md](../../authoring-guide.md) (examples for every event). **Checklist:** [reference.md](./reference.md).

**Sample config:** [settings.ts](../../settings.ts) in this repository.

---

## When to apply this skill

- User asks to sync Jira with GitHub PRs, deploys, CI, releases, labels, etc.
- User edits `settings.ts`, `jira-sync.yml`, or messages/deploy sections
- User adopts jira-sync into a new repository

Do **not** use for general Jira ticket implementation (coding tasks) — only for **sync configuration**.

---

## Workflow (strict order)

### 1. Clarify repo-specific strings

Collect or infer (ask if missing):

| Input | Example |
| ----- | ------- |
| Jira **project key** | `PROJ` |
| Status **names** (exact, case-sensitive) | `In Review`, `Done`, `Deployed (Test)` |
| Transition **names** | `Start review`, `Rework`, `Request changes` |
| Deploy workflow **`name:`** (YAML `name:` field) | Must match `name:` in your deploy workflow YAML |
| Other workflow names | `Quality Gate` |
| Target branches | `dev`, `test`, `main` |

Never guess Jira status spelling — match the customer’s board or `settings.ts` in the same repo.

### 2. Plan rules before coding

For each user intent, specify:

1. **GitHub event** → `When.*`
2. **Conditions** → `.if(If.*, …)`, Jira filters `.ifJiraStatus` / `.unlessJiraStatus`
3. **Action** → `.transitionTo` | `.deployToJiraStatus` | `.comment`
4. **Rule order** — more specific rules **above** broader ones

Document the plan briefly; then edit **only** `settings.ts` unless engine gaps require `lib/` changes.

### 3. Edit `settings.ts` correctly

**Imports:** enums from `./lib/config` — `config`, `When`, `If`, `PrAct`, `RunEnd`, `CheckEnd`, `ReleaseAct`, `Review`, `ReviewAct`, `RunTrigger`, `Pr`.

**Strings stay inline** — Jira statuses, transition names, workflow titles, message bodies.

**Pattern:**

```ts
export const builtSyncConfig = config('PROJECT-KEY')
  .options({ skipMarker: '[skip-jira]', noTransitionMessageId: 'noTransition', /* … */ })
  .messages({ /* every referenced template id */ })
  .deploy({ /* only if deployToJiraStatus is used */ })
  .when(When.PullRequest)
  .named('Descriptive name')
  .if(If.Action, PrAct.Opened)
  .if(If.PrState, Pr.Open)
  .ifNot(If.Draft)
  .transitionTo('In Review', { via: ['Start review'] })
  .build();
```

**Quality gates:**

- Every `comment('x')` / `onNoTransition` / `commentAfterSuccess` id exists in `.messages`
- PR transition rules on open PRs use `.if(If.PrState, Pr.Open)` or merged exception
- QG-on-PR rules use `.if(If.RunEvent, RunTrigger.PullRequest)` when ignoring push/workflow_call runs
- Deploy failure rules include `RunEnd.Failure`, `RunEnd.Cancelled`, `RunEnd.TimedOut` when commenting failures
- Use `.if(If.NotLabel, 'skip-jira')` or `skipMarker` for opt-out when requested

Copy-paste event templates from [authoring-guide.md](../../authoring-guide.md) and adapt strings.

### 4. Update `jira-sync.yml` when triggers change

File: `.github/workflows/jira-sync.yml` (sibling of the `jira-sync/` folder).

| New rule uses | YAML must include |
| ------------- | ----------------- |
| `PrAct.*` in `.if(If.Action, …)` | same values under `on.pull_request.types` |
| `.if(If.Workflow, 'Name')` | `'Name'` in `on.workflow_run.workflows` |
| `When.CheckSuite` | `check_suite.types: [completed]`, permission `checks: read` |
| `When.Release` | `release.types: [published]` |
| `When.CheckRun` | `check_run.types: [completed]` |

Keep entrypoint: `node .github/workflows/jira-sync/dist/run.mjs`.

### 5. Rebuild and verify

From jira-sync directory:

```bash
node build.mjs
node dist/verify.mjs
```

Optional Jira API check:

```bash
node dist/verify.mjs --preflight
```

Requires `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.

**Commit `dist/run.mjs` and `dist/verify.mjs`** with source changes.

### 6. Engine changes (rare)

Only if the user needs a **new GitHub webhook field** or event not in `syncCatalog.ts`:

1. Add enum + JSDoc in `lib/config/syncCatalog.ts`
2. Parse in `lib/adapters/github/parseEvent.ts`
3. Match in `lib/engine/matchRule.ts`
4. Extend `lib/config/dsl.ts` overloads for typed `.if()`
5. Add flow scenario in `lib/audit/flowScenarios.ts` + unit test
6. Rebuild `dist/`

Default: **settings + YAML only**.

---

## Common mistakes (avoid)

| Mistake | Fix |
| ------- | --- |
| Jira strings in `syncCatalog.ts` | Move to `settings.ts` |
| Broad merge rule before `main` → Done | Reorder rules |
| Missing message key | Add to `.messages({ … })` |
| Workflow name typo | Match deploy/QG YAML `name:` exactly |
| Forgot `workflow_run` on default branch | Document: listener must be on `main` |
| Edit TS without rebuilding dist | Run `node build.mjs`, commit dist |
| `tsx run.ts` in Actions | Use bundled `dist/run.mjs` only |

---

## Output expectations

When finishing a config task, report:

1. **Rules added/changed** (names + Jira effect)
2. **YAML changes** (if any)
3. **Verify command** run and result
4. **Manual follow-up** (Jira transitions, secrets, label `skip-jira`, etc.)

---

## Related docs

| Doc | Path |
| --- | ---- |
| Authoring guide | [authoring-guide.md](../../authoring-guide.md) |
| Setup / secrets | [setup.md](../../setup.md) |
| Enum reference | [syncCatalog.ts](../../lib/config/syncCatalog.ts) (hover in IDE) |
