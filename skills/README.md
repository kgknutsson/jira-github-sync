# Agent skill

| Skill | Purpose |
| ----- | ------- |
| [jira-sync-config](./jira-sync-config/SKILL.md) | Write or review `.github/jira-sync.config.yml` rules and align `.github/workflows/jira-sync.yml` |

## Install in a repository

- **Cursor:** copy `skills/jira-sync-config/` from this repository to `.cursor/skills/jira-sync-config/` and reload skills.
- **GitHub Copilot (VS Code):** copy it to `.github/skills/jira-sync-config/`.

The skill links to the docs in this repository, so it works without copying anything else.

## When to use

Ask the agent to use **`jira-sync-config`** when you:

- add or change Jira rules, messages or the deploy map;
- connect a new GitHub event or workflow to Jira statuses;
- set up jira-github-sync in a new repository, or debug why an issue did not move.

Human docs: [README](../README.md) · [setup](../docs/setup.md) · [rules reference](../docs/configuration.md)
