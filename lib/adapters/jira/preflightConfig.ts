/**
 * Validates `settings.ts` Jira strings against the live project workflow.
 *
 * @module adapters/jira/preflightConfig
 */
import type { BuiltSyncConfig } from '../../config/types';
import { jiraStatusNamesFromConfig } from '../../config/jiraConfigLabels';
import type { JiraConfig } from './client';
import { listProjectStatusNames } from './client';

export type JiraPreflightIssue = { level: 'error' | 'warning'; message: string };

/** Compares configured status names to Jira project workflow columns. */
export async function validateJiraStringsAgainstProject(
  config: JiraConfig,
  built: BuiltSyncConfig
): Promise<JiraPreflightIssue[]> {
  const issues: JiraPreflightIssue[] = [];
  let available: Set<string>;
  try {
    available = await listProjectStatusNames(config, built.projectKey);
  } catch (err) {
    issues.push({
      level: 'error',
      message: `Could not load Jira statuses for ${built.projectKey}: ${String(err)}`,
    });
    return issues;
  }

  for (const name of jiraStatusNamesFromConfig(built)) {
    if (!available.has(name)) {
      issues.push({
        level: 'error',
        message: `Jira project ${built.projectKey} has no status named "${name}" (check settings strings)`,
      });
    }
  }

  if (available.size === 0) {
    issues.push({ level: 'warning', message: 'Jira returned no statuses for project' });
  }

  return issues;
}
