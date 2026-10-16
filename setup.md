# Jira ↔ GitHub sync — setup

Checklist for integrating **jira-github-sync** into your GitHub repository. The bundled **`settings.ts`** is a working sample (project key **`PROJ`**, example workflow names) — replace with your Jira project and CI workflow `name:` values.

**How to write rules:** [authoring-guide.md](authoring-guide.md)

---

## What it does (short)

Behavior depends on **`settings.ts`**. The sample config includes:

| GitHub event | Typical Jira effect (sample) |
| ------------ | ------------------------------ |
| PR opened / updated (not draft, no `skip-jira` label) | **In Review** (+ optional PR link) |
| PR draft / changes requested | **In Progress** |
| PR approved | Comment with PR link |
| PR merged to **main** | **Done** (+ comment) |
| PR merged (other bases) | Comment only |
| **Quality Gate** on a PR | Comment; failure may move **In Review** → **In Progress** |
| **Check suite** failed (while **In Review**) | Same **In Progress** path as QG failure |
| **Release** published | Comment with tag + link |
| Named deploy workflow success | **Deployed (Dev)** / **Deployed (Test)** / **Done** (by env) |
| Deploy failed | Comment with run URL |

No Jira board webhook — only GitHub Actions + Jira REST API.

---

## Setup checklist

### 1. Code on GitHub

- [ ] Consumer workflow **[templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml)** copied to **`.github/workflows/jira-sync.yml`** (adjust `run:` path and triggers).
- [ ] Package vendored (include committed **`dist/`**).
- [ ] Listener workflow merged to your **default branch** if you use `workflow_run` (deploy / CI).

### 2. GitHub secrets

Add on **your repository** (or org secrets visible to it):

| Secret            | Example / notes |
| ----------------- | --------------- |
| `JIRA_BASE_URL`   | `https://your-site.atlassian.net` (no trailing slash) |
| `JIRA_USER_EMAIL` | Atlassian account for the **bot/service** user |
| `JIRA_API_TOKEN`  | [Create API token](https://id.atlassian.com/manage-profile/security/api-tokens) |

- [ ] All three secrets set (names must match exactly).
- [ ] Bot user can browse your Jira project and **transition** issues.
- [ ] `GITHUB_TOKEN` is automatic — no secret needed.

**If secrets are missing:** the job runs but logs `Jira secrets not configured; skipping`.

### 3. Jira workflow

Status and transition **strings in `settings.ts` must match Jira exactly** (case-sensitive). Edit the sample to match your board, or rename statuses in Jira to match the sample.

- [ ] Required statuses and transitions exist for your rules.
- [ ] Issue keys in GitHub use your project key (e.g. `PROJ-123`).

After TS changes: `node build.mjs` in the package folder and commit **`dist/`**.

### 4. Bot user (recommended)

- [ ] Dedicated Atlassian user — not a personal dev account.
- [ ] API token only in GitHub Secrets (rotate on offboarding).

### 5. Smoke test

**GitHub**

- [ ] PR with **`YOUR-KEY-*`** in title or branch → **Actions** → **Jira Sync** succeeds.
- [ ] Matching issue moves or gets a comment in Jira.

**Optional (local, with `JIRA_*` in env)**

```bash
npm run qa
node dist/verify.mjs --preflight
```

- [ ] Preflight prints `Jira preflight OK`.

---

## Deploy environment mapping (sample)

From bundled [`settings.ts`](settings.ts):

| Deploy env | Typical branch | Jira status (sample) |
| ---------- | -------------- | -------------------- |
| `dev`      | `dev`          | Deployed (Dev)       |
| `test`     | `test`         | Deployed (Test)      |
| `prod`     | `main`         | Done                 |

Job name pattern in sample: `Build and Deploy (dev|test|prod)`.

---

## Quick troubleshooting

| Symptom | Check |
| ------- | ----- |
| Job green, nothing in Jira | Secrets missing; no issue key in PR/branch/commit; or `[skip-jira]` in text |
| “No transition” comment | No workflow path to target status — adjust Jira or `settings.ts` |
| Deploy did not update Jira | Listener on default branch? Issue key on commit/branch? |
| Fork PR | Sync skipped by design |
| 401 / preflight fails | Wrong email or token |

Logs: GitHub → **Actions** → **Jira Sync** (prefix `[jira-sync]`).

---

**Workflow template:** [templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml) · **Rules:** [settings.ts](settings.ts)
