/**
 * Runtime options for issue-key resolution, skip markers, and Jira error handling.
 *
 * **GitHub source:** N/A — repo policy in `settings.ts` via `.options({ … })`.
 *
 * **Use with:** First chain call on `config('PROJECT')` before `.messages()` / rules.
 *
 * @module config/syncOptions
 *
 * @example Typical options
 * ```ts
 * config('PROJ')
 *   .options({
 *     resolveKeyFromCommitMessage: true,
 *     processAllMatchingIssueKeys: false,
 *     failOnJiraError: true,
 *     skipMarker: '[skip-jira]',
 *     noTransitionMessageId: 'noTransition',
 *   })
 * ```
 */

/** Runtime options merged with {@link DEFAULT_SYNC_OPTIONS}. */
export type SyncOptions = {
  /**
   * When resolving keys on `workflow_run` / checks / deployments, also scan the head commit message.
   * **Use when:** Deploy workflows put `PROJ-123` only in merge commit message.
   */
  resolveKeyFromCommitMessage: boolean;
  /**
   * Run the matched rule for **every** issue key found (default: first key only).
   * **Use when:** One PR mentions multiple tickets.
   */
  processAllMatchingIssueKeys: boolean;
  /**
   * Fail the GitHub Actions job if Jira API returns an error (recommended `true` in CI).
   */
  failOnJiraError: boolean;
  /**
   * Skip sync when PR/commit/comment text contains this substring (case-insensitive).
   * Set `null` to disable. Complements {@link If.NotLabel} for label-based opt-out.
   */
  skipMarker: string | null;
  /**
   * Default `.messages({ … })` key when a transition/deploy cannot run and the rule omits
   * `onNoTransition`. Set `null` to post no comment. Must exist in `.messages(...)`.
   */
  noTransitionMessageId: string | null;
};

/** Defaults applied before `settings.ts` `.options({ … })` overrides. */
export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  failOnJiraError: true,
  skipMarker: '[skip-jira]',
  noTransitionMessageId: 'noTransition',
};
