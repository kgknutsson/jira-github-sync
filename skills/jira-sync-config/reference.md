# jira-sync rules — agent cheat sheet

Full reference: [docs/configuration.md](https://github.com/kgknutsson/jira-github-sync/blob/main/docs/configuration.md).

| File | Role |
| ---- | ---- |
| `.github/jira-sync.config.yml` | **Edit this:** project key, messages, deploy map, rules |
| `.github/workflows/jira-sync.yml` | Triggers and permissions; runs `kgknutsson/jira-github-sync@v1` |

## Rule shape

```yaml
  - name: Unique label
    when: pull_request              # event
    if: { action: closed, merged: true, baseRef: main }   # all must match; lists = any of
    ifJiraStatus: In Review         # optional Jira-side filter (or unlessJiraStatus)
    transitionTo: Done              # exactly one of: transitionTo / deployToJiraStatus: true / comment: <messageId>
    via: [Finish]                   # transitionTo only
    onNoTransition: noTransition    # transitionTo / deploy only
    commentAfterSuccess: merged     # transitionTo / deploy only
    commentWhenSkipped: alreadyDone # transitionTo / deploy only
    linkGithub: pull_request        # pull_request | workflow_run | release
    fields: { customfield_10042: '{prUrl}' }
```

## Conditions by event

| Condition | Events |
| --------- | ------ |
| `action` | all except `workflow_run`, `push` |
| `prState` | `pull_request`, `pull_request_review` |
| `merged`, `draft` | `pull_request` |
| `reviewState` | `pull_request_review` |
| `baseRef` | `pull_request`, `pull_request_review`, `issue_comment` (PR comments), `merge_group` |
| `headRef` | same as `baseRef`, plus `push` |
| `label`, `notLabel` | `pull_request`, `pull_request_review`, `issue_comment` (PR comments) |
| `author` | `pull_request`, `pull_request_review` |
| `workflow`, `runEvent` | `workflow_run` |
| `conclusion` | `workflow_run`, `check_suite`, `check_run` (third-party CI only) |
| `checkName` | `check_suite`, `check_run` |
| `deploymentEnvironment`, `deploymentState` | `deployment_status` |
| `releaseTag` | `release` |

## Placeholders

`{issueKey}`, `{url}`, `{prUrl}`, `{baseRef}`, `{headRef}`, `{currentStatus}`, `{targetStatus}`, `{status}`, `{env}`, `{workflowName}`, `{runEvent}`, `{conclusion}`, `{checkName}`, `{author}`, `{labels}`, `{releaseTag}`, `{releaseName}`, `{ref}`, `{deploymentState}`.

## Workflow checklist

- [ ] Every `when` has an `on:` trigger; every matched `action` is under `types`
- [ ] Every `workflow` name is under `on.workflow_run.workflows` with `types: [completed]`
- [ ] Permissions: `contents: read`, `pull-requests: read`, `actions: read` (deploy rules)
- [ ] Job skips fork workflow runs (`github.event.workflow_run.head_repository.id == github.repository_id`)
- [ ] Checkout (`sparse-checkout: .github`) runs before the action
- [ ] Merged to the default branch (needed for `workflow_run`)

Validate: `npx -y https://github.com/kgknutsson/jira-github-sync/archive/refs/tags/v1.tar.gz validate .github/jira-sync.config.yml --workflow .github/workflows/jira-sync.yml`
