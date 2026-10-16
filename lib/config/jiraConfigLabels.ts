/**
 * Helpers for Jira-side strings in compiled config (opaque labels from `settings.ts`).
 *
 * The engine never defines Jira columns or transitions — it only compares and
 * sends whatever strings the repo configured.
 *
 * @module config/jiraConfigLabels
 */
import type { BuiltSyncConfig } from './types';

/** Jira workflow column display name (project-specific; configured in settings). */
export type JiraStatusName = string;

/** Jira transition label as shown in the UI (project-specific; configured in settings). */
export type JiraTransitionName = string;

/** Every Jira status string referenced by deploy maps and rules (for docs/tests). */
export function jiraStatusNamesFromConfig(built: BuiltSyncConfig): string[] {
  const names = new Set<string>();
  for (const status of Object.values(built.deploy.environmentToJiraStatus)) {
    names.add(status);
  }
  for (const rule of built.rules) {
    if (rule.when.jiraStatusIs) names.add(rule.when.jiraStatusIs);
    if (rule.when.jiraStatusIsNot) names.add(rule.when.jiraStatusIsNot);
    if (rule.then.kind === 'transition') names.add(rule.then.status);
  }
  return [...names].sort();
}
