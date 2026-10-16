# Setup

Adding jira-github-sync to a repository takes a Jira bot account, three secrets, a workflow file and a rules file.

## 1. Jira bot account

- [ ] Create (or reuse) a dedicated Atlassian account for automation, not a personal one.
- [ ] Give it access to the project: browse, transition and comment on issues; add links; edit issues if you use `fields`.
- [ ] Create an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) for it and rotate it when people with access leave.

## 2. GitHub secrets

Add these as repository secrets, organization secrets shared with the repository, or environment secrets:

| Secret | Value |
| ------ | ----- |
| `JIRA_BASE_URL` | `https://your-site.atlassian.net` |
| `JIRA_USER_EMAIL` | The bot account's email |
| `JIRA_API_TOKEN` | The bot account's API token |

Environment secrets keep the Jira token out of every other workflow in the repository, but a job only receives them when it names the environment. Add this to the job in the workflow file; `deployment: false` stops each run from appearing as a deployment on your PRs:

```yaml
    environment:
      name: jira-sync
      deployment: false
```

Don't give that environment required reviewers, a wait timer or branch restrictions: they apply to every Jira Sync run.

The action also uses the workflow's own `GITHUB_TOKEN` (no secret needed) to find the PR behind a commit or comment and to read deploy job names. When the Jira secrets don't reach the job, the action still validates the rules, then warns about each issue it could not update. Dependabot PRs, for example, get no Actions secrets.

## 3. Workflow file

Copy [templates/jira-sync.workflow.yml](../templates/jira-sync.workflow.yml) to `.github/workflows/jira-sync.yml`, then:

- [ ] Keep the triggers in line with your rules: every `action` a rule matches under `types`, every workflow name under `workflow_run.workflows`.
- [ ] Adjust the `pull_request` branches (and the matching branch list in the job's `if:`) to your branches.
- [ ] Merge it to the **default branch**: GitHub only sends `workflow_run` events to workflows there.

The template asks for `contents: read` (checkout), `pull-requests: read` (PR lookups) and `actions: read` (deploy job names) and nothing else. It checks out only `.github`, queues runs per PR instead of cancelling them, and skips workflow runs that came from forks.

## 4. Rules file

Copy [templates/jira-sync.config.yml](../templates/jira-sync.config.yml) to `.github/jira-sync.config.yml` and set `projectKey`, your Jira status and transition names, and your workflow names. See the [rules file reference](configuration.md).

## 5. Check it

Locally (Node 20+):

```bash
npx -y https://github.com/kgknutsson/jira-github-sync/archive/refs/tags/v1.0.1.tar.gz validate .github/jira-sync.config.yml --workflow .github/workflows/jira-sync.yml
```

Use the release your workflow runs. npx caches each URL, so a moving tag like `v1` would keep running the first version it downloaded.

With `JIRA_BASE_URL`, `JIRA_USER_EMAIL` and `JIRA_API_TOKEN` in your environment, add `--preflight` to also check the bot's login and that every status in your rules exists in the Jira project. In CI, the same check runs with `validate-only: true`.

Then open a PR with an issue key in its title or branch (e.g. `PROJ-123 Add login`) and watch **Actions → Jira Sync**: the log names the rule that matched, and the issue moves or gets a comment.

## Versions

Use `kgknutsson/jira-github-sync@v1`; the `v1` tag moves to each compatible release. To control updates yourself, pin a full commit SHA and let Dependabot propose bumps:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Job green, nothing in Jira | `Jira credentials missing` warning → the secrets don't reach the job (environment secrets need `environment:` on the job); `No PROJ issue key` → no key in PR title/body/branch or commit; `Skip marker` → `[skip-jira]` in the text |
| `No rule matched` | The event or its `action` matches no rule; rules run top to bottom, first match wins |
| A PR event did nothing at all | The action is missing from `on.pull_request.types`; the job log warns about it |
| No-transition comment on the issue | Jira has no transition from the current status to the target; adjust the Jira workflow or the rule |
| Deploy did not update Jira | Workflow merged to the default branch? Workflow name listed under `workflow_run.workflows`? Issue key on the PR or commit? |
| `check_suite` / `check_run` rule never runs | GitHub does not trigger workflows for GitHub Actions checks; use `workflow_run` |
| `401` / `403` from Jira | Wrong email or token, or the bot lacks project permissions |

Logs are under **Actions → Jira Sync** with the prefix `[jira-sync]`; rules-file problems appear as annotations on the file.
