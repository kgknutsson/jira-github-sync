/**
 * Semantic checks on a loaded config: message references, deploy maps, duplicate rule names and
 * unknown `{placeholders}`. Issues carry a `path` into the rules file so errors get line numbers.
 *
 * @module config/validateConfig
 */
import { PLACEHOLDERS } from './catalog';
import type { BuiltSyncConfig, RuleStep } from './types';
import { DEFAULT_SYNC_OPTIONS } from './syncOptions';

/** Single config validation finding (error blocks sync; warning is advisory). */
export type ConfigValidationIssue = {
  level: 'error' | 'warning';
  message: string;
  /** Location in the rules file, e.g. `['rules', 2, 'comment']`. */
  path?: (string | number)[];
};

const STEP_MESSAGE_FIELDS = ['onNoTransition', 'commentAfterSuccess', 'commentWhenSkipped'] as const;

/** Message template ids a rule step references, with the rules-file key holding each one. */
export function messageReferences(step: RuleStep): { field: string; key: string }[] {
  if (step.kind === 'comment') return [{ field: 'comment', key: step.messageKey }];
  return STEP_MESSAGE_FIELDS.flatMap((field) => {
    const key = step[field];
    return key ? [{ field, key }] : [];
  });
}

function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1]!)
    .filter((name) => !Object.hasOwn(PLACEHOLDERS, name));
}

/** Validates a loaded config before any Jira/GitHub calls. */
export function validateBuiltSyncConfig(built: BuiltSyncConfig): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!built.projectKey.trim()) {
    issues.push({ level: 'error', message: 'projectKey is empty', path: ['projectKey'] });
  }
  if (built.rules.length === 0) {
    issues.push({ level: 'error', message: 'No rules defined', path: ['rules'] });
  }

  const namesById = new Map<string, string>();
  built.rules.forEach((rule, index) => {
    const other = namesById.get(rule.id);
    if (other !== undefined) {
      issues.push({
        level: 'error',
        message: `Rules "${other}" and "${rule.name}" get the same id (${rule.id}); give them different names`,
        path: ['rules', index, 'name'],
      });
    }
    namesById.set(rule.id, rule.name);

    for (const { field, key } of messageReferences(rule.then)) {
      if (!Object.hasOwn(built.messages, key)) {
        issues.push({
          level: 'error',
          message: `Rule "${rule.name}" references unknown message "${key}"`,
          path: ['rules', index, field],
        });
      }
    }
    for (const [fieldId, template] of Object.entries(rule.then.extras?.fields ?? {})) {
      for (const name of unknownPlaceholders(template)) {
        issues.push({
          level: 'warning',
          message: `Rule "${rule.name}" field ${fieldId} uses unknown placeholder {${name}}`,
          path: ['rules', index, 'fields', fieldId],
        });
      }
    }
  });

  if (built.deploy.jobNameRegex !== undefined) {
    try {
      new RegExp(built.deploy.jobNameRegex);
    } catch {
      issues.push({
        level: 'error',
        message: 'deploy.jobNameRegex is not a valid regular expression',
        path: ['deploy', 'jobNameRegex'],
      });
    }
  }

  for (const [branch, env] of Object.entries(built.deploy.branchToEnvironment)) {
    if (!Object.hasOwn(built.deploy.environmentToJiraStatus, env)) {
      issues.push({
        level: 'warning',
        message: `deploy.branchToEnvironment maps "${branch}" to "${env}", which environmentToJiraStatus does not list`,
        path: ['deploy', 'branchToEnvironment', branch],
      });
    }
  }

  const defaultNoTransition = { ...DEFAULT_SYNC_OPTIONS, ...built.options }.noTransitionMessageId;
  if (defaultNoTransition != null && !Object.hasOwn(built.messages, defaultNoTransition)) {
    issues.push({
      level: 'error',
      message: `options.noTransitionMessageId references unknown message "${defaultNoTransition}" (add it to messages or set it to null)`,
      path: ['options', 'noTransitionMessageId'],
    });
  }

  const referenced = new Set<string>(defaultNoTransition ? [defaultNoTransition] : []);
  for (const rule of built.rules) {
    for (const { key } of messageReferences(rule.then)) referenced.add(key);
  }
  for (const [key, template] of Object.entries(built.messages)) {
    if (!referenced.has(key)) {
      issues.push({
        level: 'warning',
        message: `Message "${key}" is not used by any rule`,
        path: ['messages', key],
      });
    }
    for (const name of unknownPlaceholders(template)) {
      issues.push({
        level: 'warning',
        message: `Message "${key}" uses unknown placeholder {${name}}`,
        path: ['messages', key],
      });
    }
  }

  return issues;
}

/** Throws if config has validation errors (used at engine startup). */
export function assertValidConfig(built: BuiltSyncConfig): void {
  const issues = validateBuiltSyncConfig(built).filter((i) => i.level === 'error');
  if (issues.length > 0) {
    throw new Error(`Invalid jira-sync config:\n${issues.map((i) => `- ${i.message}`).join('\n')}`);
  }
}
