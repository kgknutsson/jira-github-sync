# jira-github-sync

Portable **GitHub Actions ↔ Jira** sync engine. Rules live in TypeScript (`settings.ts`); Actions runs a **bundled** `dist/run.mjs` (no `npm install` needed in your app).

**Repository:** https://github.com/kgknutsson/jira-github-sync

## Use in your app

1. **Vendor** this repo under **`.github/workflows/jira-sync/`** (copy the folder, or add it as a git submodule and set `submodules: true` on `actions/checkout`).
2. Copy **[templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml)** → your repo **`.github/workflows/jira-sync.yml`** (it already runs `node .github/workflows/jira-sync/dist/run.mjs`) and adjust triggers to your rules.
3. Edit **`settings.ts`** — project key, Jira status/transition strings, workflow names, rules.
4. Add GitHub secrets: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.
5. In the package folder: `npm ci`, `node build.mjs`, commit **`dist/`**, then `node dist/verify.mjs` to check `settings.ts` against your workflow.

| Doc | Purpose |
| --- | ------- |
| [setup.md](setup.md) | Secrets, Jira workflow, smoke test |
| [authoring-guide.md](authoring-guide.md) | DSL + examples for every GitHub event |
| [skills/](skills/README.md) | Cursor / Copilot **jira-sync-config** skill |

## Development

```bash
npm ci
npm run qa          # build + typecheck + vitest (tests/) + dist/verify.mjs
node dist/verify.mjs --preflight   # optional; needs JIRA_* env
```

All unit tests live under **`tests/`** and exercise the bundled sample `settings.ts`. After you customize `settings.ts` in your app, use `node dist/verify.mjs` (portable checks) rather than `npm run qa`.

## Layout

```
jira-github-sync/
  settings.ts          ← your rules (sample config included)
  dist/run.mjs         ← Actions entry (committed)
  dist/verify.mjs      ← local checks: settings + workflow YAML (committed)
  lib/                 ← engine
  templates/           ← consumer workflow YAML
  skills/              ← agent skills (copy with package)
  tests/               ← unit tests for the engine and sample config
```

## License

MIT — see [LICENSE](LICENSE).
