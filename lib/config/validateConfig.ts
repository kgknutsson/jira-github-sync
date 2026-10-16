/**
 * Static validation for `settings.ts` (message keys, deploy regex, duplicate rule ids).
 *
 * @module config/validateConfig
 */
import type { BuiltSyncConfig, RuleStep } from './types';
import { DEFAULT_SYNC_OPTIONS } from './syncOptions';

/** Single config validation finding (error blocks sync; warning is advisory). */
export type ConfigValidationIssue = {
  level: 'error' | 'warning';
  message: string;
};

/** Collects message template keys referenced by a rule step. */
export function collectMessageKeysFromStep(step: RuleStep): string[] {
  const keys: string[] = [];
  if (step.kind === 'comment') keys.push(step.messageKey);
  if (step.kind === 'transition') {
    if (step.onNoTransition) keys.push(step.onNoTransition);
    if (step.commentAfterSuccess) keys.push(step.commentAfterSuccess);
    if (step.commentWhenSkipped) keys.push(step.commentWhenSkipped);
  }
  if (step.kind === 'deploy') {
    if (step.onNoTransition) keys.push(step.onNoTransition);
    if (step.commentAfterSuccess) keys.push(step.commentAfterSuccess);
    if (step.commentWhenSkipped) keys.push(step.commentWhenSkipped);
  }
  return keys;
}

/** Validates `settings.ts` output before any Jira/GitHub calls. */
export function validateBuiltSyncConfig(built: BuiltSyncConfig): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];

  if (!built.projectKey.trim()) {
    issues.push({ level: 'error', message: 'projectKey is empty' });
  }

  if (built.rules.length === 0) {
    issues.push({ level: 'error', message: 'No rules defined' });
  }

  const ruleIds = new Set<string>();
  for (const rule of built.rules) {
    if (ruleIds.has(rule.id)) {
      issues.push({ level: 'error', message: `Duplicate rule id: ${rule.id}` });
    }
    ruleIds.add(rule.id);

    for (const key of collectMessageKeysFromStep(rule.then)) {
      if (!built.messages[key]) {
        issues.push({
          level: 'error',
          message: `Rule "${rule.name}" references unknown message key: ${key}`,
        });
      }
    }
  }

  try {
    new RegExp(built.deploy.jobNameRegex);
  } catch {
    issues.push({ level: 'error', message: 'deploy.jobNameRegex is invalid' });
  }

  const envKeys = Object.keys(built.deploy.environmentToJiraStatus);
  for (const branch of Object.values(built.deploy.branchToEnvironment)) {
    if (!envKeys.includes(branch)) {
      issues.push({
        level: 'warning',
        message: `branchToEnvironment maps to "${branch}" but environmentToJiraStatus has no such key`,
      });
    }
  }

  if (Object.keys(built.messages).length === 0) {
    issues.push({ level: 'warning', message: 'No message templates defined' });
  }

  const defaultNoTransition = {
    ...DEFAULT_SYNC_OPTIONS,
    ...built.options,
  }.noTransitionMessageId;
  if (defaultNoTransition != null && !built.messages[defaultNoTransition]) {
    issues.push({
      level: 'error',
      message: `options.noTransitionMessageId references unknown message key: ${defaultNoTransition}`,
    });
  }

  const referenced = new Set<string>();
  if (defaultNoTransition) referenced.add(defaultNoTransition);
  for (const rule of built.rules) {
    for (const key of collectMessageKeysFromStep(rule.then)) {
      referenced.add(key);
    }
  }
  for (const key of Object.keys(built.messages)) {
    if (!referenced.has(key)) {
      issues.push({
        level: 'warning',
        message: `Message template "${key}" is never referenced by a rule`,
      });
    }
  }

  return issues;
}

/** Throws if config has validation errors (used at engine startup). */
export function assertValidConfig(built: BuiltSyncConfig): void {
  const issues = validateBuiltSyncConfig(built).filter((i) => i.level === 'error');
  if (issues.length > 0) {
    throw new Error(
      `Invalid jira-sync settings:\n${issues.map((i) => `- ${i.message}`).join('\n')}`
    );
  }
}
