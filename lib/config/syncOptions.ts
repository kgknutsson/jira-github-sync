/**
 * Runtime options for issue-key resolution, skip markers, and Jira error handling
 * (`options:` in the rules file).
 *
 * @module config/syncOptions
 *
 * @example Typical options
 * ```yaml
 * options:
 *   resolveKeyFromCommitMessage: true
 *   processAllMatchingIssueKeys: false
 *   failOnJiraError: true
 *   skipMarker: '[skip-jira]'
 *   noTransitionMessageId: noTransition
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
   * On push-triggered deploys, `push`, and deployment events, walk up to this many recent commits
   * reachable from the head SHA and collect issue keys from linked PRs and messages. `0` disables.
   */
  resolveKeysFromRecentCommits: number;
  /**
   * Fail the GitHub Actions job if Jira API returns an error (recommended `true` in CI).
   */
  failOnJiraError: boolean;
  /**
   * Skip sync when PR/commit/comment text contains this substring (case-insensitive).
   * Set `null` to disable. Complements a `notLabel` condition for label-based opt-out.
   */
  skipMarker: string | null;
  /**
   * Message id posted when a transition/deploy cannot run and the rule has no `onNoTransition`.
   * `null` posts nothing. Defaults to `noTransition` when the rules file defines that message.
   */
  noTransitionMessageId: string | null;
};

/** Defaults applied before the rules file's `options:` overrides. */
export const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  resolveKeyFromCommitMessage: true,
  processAllMatchingIssueKeys: false,
  resolveKeysFromRecentCommits: 100,
  failOnJiraError: true,
  skipMarker: '[skip-jira]',
  noTransitionMessageId: 'noTransition',
};
