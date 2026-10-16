/**
 * Structured console logging for GitHub Actions (prefix `[jira-sync]`).
 *
 * @module logger
 */

const PREFIX = '[jira-sync]';

/** Minimal logger used by the sync engine (stdout/stderr only). */
export const log = {
  info(message: string, err?: unknown): void {
    if (err !== undefined) {
      console.log(`${PREFIX} ${message}`, err);
    } else {
      console.log(`${PREFIX} ${message}`);
    }
  },
  error(message: string, err?: unknown): void {
    console.error(`${PREFIX} ${message}`, err ?? '');
  },
};
