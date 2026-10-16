# jira-github-sync

Portable **GitHub Actions ↔ Jira** sync engine. Rules live in TypeScript (`settings.ts`); Actions runs a **bundled** `dist/run.mjs` (no app `pnpm install` required).

**Repository:** https://github.com/kgknutsson/jira-github-sync

## Use in your app

1. **Vendor** this repo (copy folder or submodule):
   - Common path: `.github/workflows/jira-sync/` (or repo root if you submodule the whole project).
2. Copy **[templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml)** → your repo **`.github/workflows/jira-sync.yml`** and fix the `run:` line:
   - Vendored: `node .github/workflows/jira-sync/dist/run.mjs`
   - Submodule at repo root: `node dist/run.mjs`
3. Edit **`settings.ts`** — project key, Jira status/transition strings, workflow names, rules.
4. Add GitHub secrets: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.
5. Rebuild after TS edits: `node build.mjs` and commit **`dist/`**.

| Doc | Purpose |
| --- | ------- |
| [setup.md](setup.md) | Secrets, Jira workflow, smoke test |
| [authoring-guide.md](authoring-guide.md) | DSL + examples for every GitHub event |
| [skills/](skills/README.md) | Cursor / Copilot **jira-sync-config** skill |

## Development

```bash
npm ci
npm run qa          # build + vitest (tests/) + dist/verify.mjs
node dist/verify.mjs --preflight   # optional; needs JIRA_* env
```

All unit tests live under **`tests/`** in this repository only.

## Layout

```
jira-github-sync/
  settings.ts          ← your rules (sample config included)
  dist/run.mjs         ← Actions entry (committed)
  lib/                 ← engine
  templates/           ← consumer workflow YAML
  skills/              ← agent skills (copy with package)
```

## License

MIT — see [LICENSE](LICENSE).
