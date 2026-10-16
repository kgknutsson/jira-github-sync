/**
 * Optional Jira side effects on transition / comment / deploy steps.
 *
 * **Configure in `settings.ts`** on step options — not in this catalog.
 *
 * | Field | Purpose |
 * | ----- | -------- |
 * | `linkGithub` | Add Jira remote link to PR, workflow run, or release |
 * | `fields` | Set Jira custom fields (keys = field ids, values = templates) |
 *
 * Template placeholders: `{url}`, `{prUrl}`, `{baseRef}`, `{headRef}`, `{workflowName}`, …
 * (see `lib/utils/actionTemplateVars.ts`).
 *
 * @module config/jiraStepExtras
 *
 * @example PR transition + remote link to the PR
 * ```ts
 * .transitionTo('In Review', {
 *   via: ['Start review'],
 *   extras: { linkGithub: 'pull_request' },
 * })
 * ```
 *
 * @example Deploy step + workflow link
 * ```ts
 * .deployToJiraStatus({
 *   commentAfterSuccess: 'deploySuccess',
 *   extras: { linkGithub: 'workflow_run' },
 * })
 * ```
 *
 * @example Custom field (use your Jira `customfield_*` id)
 * ```ts
 * .comment('merged', {
 *   extras: {
 *     linkGithub: 'pull_request',
 *     fields: { customfield_10042: '{prUrl}' },
 *   },
 * })
 * ```
 */

/**
 * Which GitHub URL to attach when `extras.linkGithub` is set.
 *
 * **Use with:** `transitionTo` / `comment` / `deployToJiraStatus` option `extras.linkGithub`.
 */
export type GithubLinkKind =
  /** PR URL from `pull_request` / `pull_request_review` / PR-backed `issue_comment`. */
  | 'pull_request'
  /** Actions run URL from `workflow_run`. */
  | 'workflow_run'
  /** Release page URL from `release`. */
  | 'release';

/** Side-effect bundle on a rule step (`extras` on transition, comment, or deploy). */
export type JiraStepExtras = {
  /** Add (or update) a Jira remote link after the step succeeds. */
  linkGithub?: GithubLinkKind;
  /** Field id → value (supports `{placeholder}` templates). */
  fields?: Record<string, string>;
};
