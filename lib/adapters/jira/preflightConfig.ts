/**
 * Checks the rules file's Jira status names against the live project workflow.
 *
 * @module adapters/jira/preflightConfig
 */
import type { BuiltSyncConfig } from '../../config/types';
import type { JiraConfig } from './client';
import { listProjectStatusNames } from './client';

export type JiraPreflightIssue = { level: 'error' | 'warning'; message: string };

/** Every Jira status the config refers to (deploy map, status filters, transition targets). */
export function jiraStatusNamesFromConfig(built: BuiltSyncConfig): string[] {
  const names = new Set(Object.values(built.deploy.environmentToJiraStatus));
  for (const rule of built.rules) {
    if (rule.when.jiraStatusIs) names.add(rule.when.jiraStatusIs);
    if (rule.when.jiraStatusIsNot) names.add(rule.when.jiraStatusIsNot);
    if (rule.then.kind === 'transition') names.add(rule.then.status);
  }
  return [...names].sort();
}

/** Compares configured status names to the statuses in the Jira project's workflows. */
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
        message: `Jira project ${built.projectKey} has no status named "${name}" (check the rules file)`,
      });
    }
  }

  if (available.size === 0) {
    issues.push({ level: 'warning', message: 'Jira returned no statuses for project' });
  }

  return issues;
}
