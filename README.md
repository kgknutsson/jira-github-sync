# jira-github-sync

A GitHub Action that keeps Jira in step with GitHub: it moves issues between statuses and posts comments when pull requests open, get reviewed and merge, when CI or deploy workflows finish, and when releases go out. You describe what should happen in a YAML rules file in your repository.

- **Rules live in the repo** (`.github/jira-sync.config.yml`), reviewed in pull requests like code, with autocomplete and validation in VS Code / Cursor.
- **Covers the whole flow:** PR opened / draft / ready / merged, review approved or changes requested, workflow runs (CI and deploys, mapped to environments), check suites from third-party CI, releases, merge queue, pushes, deployments.
- **Conditions on both sides:** match PR labels, branches, authors, workflow names and conclusions, and the issue's current Jira status.
- **Safe defaults:** skips forks and Dependabot (no secrets), validates the rules on every run, and warns when the workflow's triggers do not match the rules.

Issue keys (`PROJ-123`) are read from PR titles, bodies, branch names and commit messages. Jira Cloud only.

## Quick start

**1. Workflow** — copy [templates/jira-sync.workflow.yml](templates/jira-sync.workflow.yml) to `.github/workflows/jira-sync.yml`. The essential part:

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize, edited, converted_to_draft, closed]
  pull_request_review:
    types: [submitted]

permissions:
  contents: read
  actions: read
  pull-requests: read

jobs:
  jira-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { sparse-checkout: .github, persist-credentials: false }
      - uses: kgknutsson/jira-github-sync@v1
        with:
          jira-base-url: ${{ secrets.JIRA_BASE_URL }}
          jira-user-email: ${{ secrets.JIRA_USER_EMAIL }}
          jira-api-token: ${{ secrets.JIRA_API_TOKEN }}
```

**2. Rules** — copy [templates/jira-sync.config.yml](templates/jira-sync.config.yml) to `.github/jira-sync.config.yml` and use your project key, Jira statuses and workflow names:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/kgknutsson/jira-github-sync/v1/jira-sync.config.schema.json
projectKey: PROJ

messages:
  merged: 'Pull request merged to {baseRef}: {url}'

rules:
  - name: PR ready → In Review
    when: pull_request
    if: { action: [opened, reopened, ready_for_review, synchronize], prState: open, draft: false }
    transitionTo: In Review
    linkGithub: pull_request

  - name: Changes requested → In Progress
    when: pull_request_review
    if: { action: submitted, prState: open, reviewState: changes_requested }
    transitionTo: In Progress

  - name: PR merged → comment
    when: pull_request
    if: { action: closed, merged: true }
    comment: merged
```

**3. Secrets** — add `JIRA_BASE_URL`, `JIRA_USER_EMAIL` and `JIRA_API_TOKEN` (a Jira bot account's API token) to the repository or organization, or to an environment the job names ([setup](docs/setup.md#2-github-secrets)).

Check everything locally before pushing, with the release your workflow runs:

```bash
npx -y https://github.com/kgknutsson/jira-github-sync/archive/refs/tags/v1.0.3.tar.gz validate .github/jira-sync.config.yml --workflow .github/workflows/jira-sync.yml
```

## Docs

| Doc | Contents |
| --- | -------- |
| [docs/setup.md](docs/setup.md) | Jira bot account, secrets, permissions, versions, troubleshooting |
| [docs/configuration.md](docs/configuration.md) | Every rules-file key, event, condition and placeholder, with examples |
| [skills/](skills/README.md) | Cursor / Copilot agent skill for writing rules |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Inputs

| Input | Default | Purpose |
| ----- | ------- | ------- |
| `config-file` | `.github/jira-sync.config.yml` | Rules file, relative to the repository root |
| `jira-base-url`, `jira-user-email`, `jira-api-token` | — | Jira Cloud credentials; when empty the action validates and skips |
| `github-token` | `${{ github.token }}` | GitHub API lookups (PR for a commit or comment, deploy job names) |
| `validate-only` | `false` | Only validate the rules and workflow (and Jira status names when credentials are set) |

## Alternatives

- **Jira Automation with the GitHub for Atlassian app.** No code: rules like "pull request merged → transition to Done" or "deployment successful → transition" run inside Jira. Install the app anyway; it shows branches, commits, PRs, builds and deployments on Jira issues, which this action does not. Its limits:
  - The rules live in Jira, not in the repo.
  - There are no triggers for PR reviews (approved / changes requested), and draft PRs fire "pull request created".
  - Deployments must be GitHub deployments.
  - Every rule run counts against Atlassian's automation allowance (150 steps a month for a whole Free site, 400 per user on Standard).
- **Jira workflow triggers** (company-managed projects) can transition on "pull request created / merged" without automation limits, but offer only a handful of triggers.
- **Single-purpose actions** such as `frieder/jira-issue-transition` or `appleboy/jira-action` perform one transition; you script the event logic in each workflow. Atlassian's own `gajira-*` actions are deprecated.

This action fits when you want the rules versioned with the code, review-driven transitions, deploy-environment mapping or Jira-status conditions, without spending automation allowance.

## Development

```bash
npm ci
npm run qa   # build dist/ and the schema, typecheck, run tests, validate the templates
```

`dist/index.mjs` and `jira-sync.config.schema.json` are generated by `node build.mjs` and committed; a test fails when they are out of date. CI runs `npm run qa` on Node 20, 22 and 24 for pushes and pull requests to `main`, and the repository's own [Jira Sync workflow](.github/workflows/jira-sync.yml) runs the local action (`uses: ./`) on pull requests and releases.

To release, update `CHANGELOG.md`, the version in `package.json` and `package-lock.json`, and the release in the docs' `validate` commands (a test checks they match), run `npm run qa`, commit, then tag and move the major tag:

```bash
git tag -a v1.0.1 -m v1.0.1 && git tag -fa v1 -m v1
git push origin v1.0.1 && git push --force origin v1
```

## License

MIT — see [LICENSE](LICENSE).
