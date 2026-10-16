# Agent skills (portable)

These skills travel with the package when you copy it into another repository.

| Skill | Purpose |
| ----- | ------- |
| [jira-sync-config](./jira-sync-config/SKILL.md) | Author or extend `settings.ts`, align `jira-sync.yml`, rebuild `dist/` |

## Install in Cursor (host repo)

Copy into the project:

```text
.cursor/skills/jira-sync-config/   ← copy from skills/jira-sync-config/
```

Or add a pointer skill that tells the agent to read the vendored path, e.g.  
`.github/workflows/jira-sync/skills/jira-sync-config/SKILL.md`

Reload skills after adding.

## Install in GitHub Copilot (host repo)

Copy `skills/jira-sync-config/` to `.github/skills/jira-sync-config/` (VS Code Copilot skill discovery).

## When to use

Ask the agent to use skill **`jira-sync-config`** when you:

- Add or change Jira sync rules, messages, deploy maps, or options
- Wire new GitHub events to Jira statuses
- Adopt jira-github-sync into a new repository

Human docs: [authoring-guide.md](../authoring-guide.md) · [setup.md](../setup.md)
