/**
 * Shared context passed to comment / transition / deploy action handlers.
 *
 * @module actions/types
 */
import type { JiraConfig } from '../adapters/jira/client';
import type { CompiledSyncConfig } from '../config/compileConfig';
import type { SyncEventContext } from '../engine/types';

/** Inputs available to all action handlers for one issue + matched rule. */
export type ActionContext = {
  jira: JiraConfig;
  compiled: CompiledSyncConfig;
  issueKey: string;
  event: SyncEventContext;
  jiraStatus: string | null;
};

/** Handler outcome (logged; does not always fail the Actions job). */
export type ActionResult = 'ok' | 'skipped' | 'no_transition';
