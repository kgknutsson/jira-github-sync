/**
 * Loads the rules file (`.github/jira-sync.config.yml`; YAML 1.2, so JSON works too) into a
 * validated {@link BuiltSyncConfig}. Every problem carries the line and column of its key.
 *
 * @module config/configFile
 */
import { readFileSync } from 'node:fs';
import { isMap, isNode, isScalar, LineCounter, parseDocument, type Document } from 'yaml';

import {
  CONDITIONS,
  EVENT_ACTIONS,
  EVENT_NAMES,
  LINK_KINDS,
  type ConditionKey,
} from './catalog';
import { DEFAULT_SYNC_OPTIONS, type SyncOptions } from './syncOptions';
import type {
  BuiltSyncConfig,
  DeployMeta,
  GitHubEventKind,
  GithubLinkKind,
  JiraStepExtras,
  RuleConditions,
  RuleStep,
  SyncRule,
} from './types';
import { validateBuiltSyncConfig } from './validateConfig';

/** One problem in the rules file; `line` / `column` are 1-based when known. */
export type ConfigFileIssue = {
  level: 'error' | 'warning';
  message: string;
  line?: number;
  column?: number;
};

/** Result of loading a rules file: `config` is `null` when any error was found. */
export type LoadedConfig = { config: BuiltSyncConfig | null; issues: ConfigFileIssue[] };

type Path = (string | number)[];
type Raw = Record<string, unknown>;
type Report = (path: Path, message: string, level?: 'error' | 'warning') => void;

const TOP_KEYS = ['projectKey', 'options', 'messages', 'deploy', 'rules'];
const OPTION_TYPES: Record<keyof SyncOptions, 'boolean' | 'string-or-null'> = {
  resolveKeyFromCommitMessage: 'boolean',
  processAllMatchingIssueKeys: 'boolean',
  failOnJiraError: 'boolean',
  skipMarker: 'string-or-null',
  noTransitionMessageId: 'string-or-null',
};
const DEPLOY_KEYS = ['jobNameRegex', 'branchToEnvironment', 'environmentToJiraStatus'];
const ACTION_KEYS = ['transitionTo', 'deployToJiraStatus', 'comment'] as const;
const RULE_KEYS = [
  'name',
  'when',
  'if',
  'ifJiraStatus',
  'unlessJiraStatus',
  ...ACTION_KEYS,
  'via',
  'onNoTransition',
  'commentAfterSuccess',
  'commentWhenSkipped',
  'linkGithub',
  'fields',
];

/** Reads and validates a rules file from disk. */
export function loadConfigFile(path: string): LoadedConfig {
  return parseConfigText(readFileSync(path, 'utf8'));
}

/** Parses and validates rules-file text. */
export function parseConfigText(text: string): LoadedConfig {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      config: null,
      issues: doc.errors.map((err) => ({
        level: 'error',
        message: `YAML syntax: ${err.message.split('\n')[0]}`,
        line: err.linePos?.[0]?.line,
        column: err.linePos?.[0]?.col,
      })),
    };
  }

  const found: { path: Path; message: string; level: 'error' | 'warning' }[] = [];
  const report: Report = (path, message, level = 'error') => found.push({ path, message, level });
  const config = readConfig(doc.toJS(), report);
  if (config && !found.some((f) => f.level === 'error')) {
    for (const issue of validateBuiltSyncConfig(config)) {
      report(issue.path ?? [], issue.message, issue.level);
    }
  }

  const issues = found.map(({ path, message, level }) => ({
    level,
    message,
    ...positionOf(doc, lineCounter, path),
  }));
  return { config: issues.some((i) => i.level === 'error') ? null : config, issues };
}

/** Line/column of the deepest existing key (or node) on `path`. */
function positionOf(doc: Document, lineCounter: LineCounter, path: Path) {
  const at = (offset: number) => {
    const { line, col } = lineCounter.linePos(offset);
    return { line, column: col };
  };
  for (let depth = path.length; depth >= 0; depth--) {
    const prefix = path.slice(0, depth);
    const last = prefix[prefix.length - 1];
    const parent = depth <= 1 ? doc.contents : doc.getIn(prefix.slice(0, -1), true);
    if (typeof last === 'string' && isMap(parent)) {
      const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === last);
      if (pair && isNode(pair.key) && pair.key.range) return at(pair.key.range[0]);
    }
    const node = depth === 0 ? doc.contents : doc.getIn(prefix, true);
    if (isNode(node) && node.range) return at(node.range[0]);
  }
  return {};
}

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** ` (did you mean "x"?)` for a close match, else `''`. */
function suggestion(word: string, options: readonly string[]): string {
  let best = '';
  let bestDistance = Infinity;
  for (const option of options) {
    const distance = editDistance(word.toLowerCase(), option.toLowerCase());
    if (distance < bestDistance) {
      best = option;
      bestDistance = distance;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(word.length / 3)) ? ` (did you mean "${best}"?)` : '';
}

function checkKeys(raw: Raw, allowed: readonly string[], path: Path, where: string, report: Report) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      report([...path, key], `Unknown key "${key}" ${where}${suggestion(key, allowed)}`);
    }
  }
}

function readStringMap(raw: unknown, path: Path, report: Report): Record<string, string> {
  const map: Record<string, string> = {};
  if (raw == null) return map;
  if (!isRecord(raw)) {
    report(path, `${path.join('.')} must be a mapping of names to text`);
    return map;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') map[key] = value;
    else report([...path, key], `${[...path, key].join('.')} must be text (quote it)`);
  }
  return map;
}

function readConfig(raw: unknown, report: Report): BuiltSyncConfig | null {
  if (!isRecord(raw)) {
    report([], 'The rules file must be a mapping with at least projectKey and rules');
    return null;
  }
  checkKeys(raw, TOP_KEYS, [], 'at the top level', report);

  const projectKey = typeof raw.projectKey === 'string' ? raw.projectKey : '';
  if (!/^[A-Z][A-Z0-9_]*$/.test(projectKey)) {
    report(['projectKey'], 'projectKey must be a Jira project key in capitals, e.g. PROJ');
  }

  const messages = readStringMap(raw.messages, ['messages'], report);
  const options = readOptions(raw.options, messages, report);
  const deploy = readDeploy(raw.deploy, report);

  const rules: SyncRule[] = [];
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    report(['rules'], 'rules must be a non-empty list');
  } else {
    raw.rules.forEach((item, index) => {
      const rule = readRule(item, index, report);
      if (rule) rules.push(rule);
    });
  }

  return { projectKey, options, messages, deploy, rules };
}

function readOptions(raw: unknown, messages: Record<string, string>, report: Report): SyncOptions {
  const options: SyncOptions = { ...DEFAULT_SYNC_OPTIONS };
  if (!isRecord(raw) || !('noTransitionMessageId' in raw)) {
    // The default no-transition comment only applies when that message exists.
    if (!Object.hasOwn(messages, 'noTransition')) options.noTransitionMessageId = null;
  }
  if (raw == null) return options;
  if (!isRecord(raw)) {
    report(['options'], 'options must be a mapping');
    return options;
  }
  checkKeys(raw, Object.keys(OPTION_TYPES), ['options'], 'in options', report);

  const writable = options as Record<string, unknown>;
  for (const [key, type] of Object.entries(OPTION_TYPES)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (type === 'boolean' ? typeof value === 'boolean' : value === null || typeof value === 'string') {
      writable[key] = value;
    } else if (type === 'boolean') {
      report(['options', key], `options.${key} must be true or false`);
    } else {
      const hint = Array.isArray(value) ? ` (quote values that start with "[", e.g. '[skip-jira]')` : '';
      report(['options', key], `options.${key} must be text or null${hint}`);
    }
  }
  return options;
}

function readDeploy(raw: unknown, report: Report): DeployMeta {
  const deploy: DeployMeta = { branchToEnvironment: {}, environmentToJiraStatus: {} };
  if (raw == null) return deploy;
  if (!isRecord(raw)) {
    report(['deploy'], 'deploy must be a mapping');
    return deploy;
  }
  checkKeys(raw, DEPLOY_KEYS, ['deploy'], 'in deploy', report);
  if (raw.jobNameRegex !== undefined) {
    if (typeof raw.jobNameRegex === 'string') deploy.jobNameRegex = raw.jobNameRegex;
    else report(['deploy', 'jobNameRegex'], 'deploy.jobNameRegex must be a regular expression string');
  }
  deploy.branchToEnvironment = readStringMap(raw.branchToEnvironment, ['deploy', 'branchToEnvironment'], report);
  deploy.environmentToJiraStatus = readStringMap(
    raw.environmentToJiraStatus,
    ['deploy', 'environmentToJiraStatus'],
    report
  );
  return deploy;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function readRule(raw: unknown, index: number, report: Report): SyncRule | null {
  const path: Path = ['rules', index];
  if (!isRecord(raw)) {
    report(path, `rules[${index}] must be a mapping with name, when and one action`);
    return null;
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const label = name ? `rule "${name}"` : `rules[${index}]`;
  checkKeys(raw, RULE_KEYS, path, `in ${label}`, report);
  if (!name) report([...path, 'name'], `${label}: name is required (it labels log lines and must be unique)`);

  const event = raw.when;
  if (typeof event !== 'string' || !EVENT_NAMES.includes(event as GitHubEventKind)) {
    report([...path, 'when'], `${label}: when must be one of ${EVENT_NAMES.join(', ')}`);
    return null;
  }
  const kind = event as GitHubEventKind;

  const conditions = readConditions(raw.if, kind, path, label, report);
  for (const [key, field] of [
    ['ifJiraStatus', 'jiraStatusIs'],
    ['unlessJiraStatus', 'jiraStatusIsNot'],
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.trim()) conditions[field] = value;
    else report([...path, key], `${label}: ${key} must be a Jira status name`);
  }

  const step = readStep(raw, kind, path, label, report);
  if (!name || !step) return null;
  return { id: `${kind}:${slugify(name)}`, name, event: kind, when: conditions, then: step };
}

function readConditions(
  raw: unknown,
  event: GitHubEventKind,
  rulePath: Path,
  label: string,
  report: Report
): RuleConditions {
  const conditions: RuleConditions = {};
  if (raw == null) return conditions;
  const path = [...rulePath, 'if'];
  if (!isRecord(raw)) {
    report(path, `${label}: if must be a mapping of conditions`);
    return conditions;
  }

  const writable = conditions as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    const keyPath = [...path, key];
    const spec = CONDITIONS[key as ConditionKey];
    if (!Object.hasOwn(CONDITIONS, key) || !spec) {
      report(keyPath, `${label}: unknown condition "${key}"${suggestion(key, Object.keys(CONDITIONS))}`);
      continue;
    }
    if (!spec.events.includes(event)) {
      report(keyPath, `${label}: "${key}" is not available on ${event} rules (only on ${spec.events.join(', ')})`);
      continue;
    }
    if (spec.type === 'boolean') {
      if (typeof value === 'boolean') writable[key] = value;
      else report(keyPath, `${label}: ${key} must be true or false`);
      continue;
    }

    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (values.length === 0 || !values.every((v) => typeof v === 'string' && v !== '')) {
      const hint = values.some((v) => typeof v === 'number' || typeof v === 'boolean')
        ? ' (quote numbers and true/false, e.g. "1.10")'
        : '';
      report(keyPath, `${label}: ${key} must be text or a list of text${hint}`);
      continue;
    }
    const strings = values as string[];
    const allowed = spec.values === 'action' ? EVENT_ACTIONS[event] : spec.values;
    const invalid = allowed ? strings.filter((v) => !allowed.includes(v)) : [];
    if (invalid.length > 0) {
      report(
        keyPath,
        `${label}: ${key} "${invalid.join('", "')}" is not valid on ${event}; use ${allowed!.join(', ')}`
      );
      continue;
    }
    writable[key] = strings.length === 1 ? strings[0] : strings;
  }
  return conditions;
}

function readStep(
  raw: Raw,
  event: GitHubEventKind,
  path: Path,
  label: string,
  report: Report
): RuleStep | null {
  const actions = ACTION_KEYS.filter((key) => raw[key] !== undefined);
  if (actions.length !== 1) {
    const where = actions.length > 1 ? [...path, actions[1]!] : path;
    const found = actions.length > 1 ? ` (found ${actions.join(' and ')})` : '';
    report(where, `${label}: needs exactly one of transitionTo, deployToJiraStatus or comment${found}`);
    return null;
  }
  const action = actions[0]!;

  const text = (key: string): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.trim()) return value;
    report([...path, key], `${label}: ${key} must be text`);
    return undefined;
  };
  const onlyWith = (key: string, allowed: readonly string[]) => {
    if (raw[key] !== undefined && !allowed.includes(action)) {
      report([...path, key], `${label}: ${key} only applies with ${allowed.join(' or ')}`);
    }
  };
  onlyWith('via', ['transitionTo']);
  for (const key of ['onNoTransition', 'commentAfterSuccess', 'commentWhenSkipped']) {
    onlyWith(key, ['transitionTo', 'deployToJiraStatus']);
  }

  const extras = readExtras(raw, event, path, label, report);
  if (action === 'comment') {
    const messageKey = text('comment');
    return messageKey ? { kind: 'comment', messageKey, extras } : null;
  }

  const options = {
    onNoTransition: text('onNoTransition'),
    commentAfterSuccess: text('commentAfterSuccess'),
    commentWhenSkipped: text('commentWhenSkipped'),
    extras,
  };
  if (action === 'deployToJiraStatus') {
    if (raw.deployToJiraStatus !== true) {
      report([...path, 'deployToJiraStatus'], `${label}: deployToJiraStatus must be true`);
      return null;
    }
    if (event !== 'workflow_run') {
      report([...path, 'deployToJiraStatus'], `${label}: deployToJiraStatus only works on workflow_run rules`);
      return null;
    }
    return { kind: 'deploy', ...options };
  }

  const status = text('transitionTo');
  if (!status) return null;
  let via: string[] | undefined;
  if (raw.via !== undefined) {
    const list: unknown[] = Array.isArray(raw.via) ? raw.via : [raw.via];
    if (list.length > 0 && list.every((v) => typeof v === 'string' && v.trim())) via = list as string[];
    else report([...path, 'via'], `${label}: via must be a transition name or a list of them`);
  }
  return { kind: 'transition', status, via, ...options };
}

function readExtras(
  raw: Raw,
  event: GitHubEventKind,
  path: Path,
  label: string,
  report: Report
): JiraStepExtras | undefined {
  const extras: JiraStepExtras = {};
  if (raw.linkGithub !== undefined) {
    const kind = raw.linkGithub as GithubLinkKind;
    if (typeof raw.linkGithub !== 'string' || !Object.hasOwn(LINK_KINDS, kind)) {
      report([...path, 'linkGithub'], `${label}: linkGithub must be one of ${Object.keys(LINK_KINDS).join(', ')}`);
    } else if (!LINK_KINDS[kind].includes(event)) {
      report(
        [...path, 'linkGithub'],
        `${label}: linkGithub "${kind}" has no URL on ${event} events (use it on ${LINK_KINDS[kind].join(', ')})`
      );
    } else {
      extras.linkGithub = kind;
    }
  }
  if (raw.fields !== undefined) {
    extras.fields = readStringMap(raw.fields, [...path, 'fields'], report);
  }
  return extras.linkGithub || extras.fields ? extras : undefined;
}
