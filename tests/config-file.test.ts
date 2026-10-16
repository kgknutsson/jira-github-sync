import { readFileSync } from 'node:fs';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { parseConfigText } from '../lib/config/configFile';
import { buildConfigSchema } from '../lib/config/configSchema';

const SAMPLE = readFileSync('templates/jira-sync.config.yml', 'utf8');

function errorsOf(yaml: string) {
  return parseConfigText(yaml).issues.filter((issue) => issue.level === 'error');
}

/** A config with one rule; `rule` is the YAML body of that rule (indented under `- `). */
function withRule(rule: string, top = ''): string {
  const body = rule
    .trim()
    .split('\n')
    .map((line, i) => `${i === 0 ? '  - ' : '    '}${line.trim()}`)
    .join('\n');
  return `projectKey: PROJ\n${top}messages:\n  note: 'Note: {url}'\nrules:\n${body}\n`;
}

describe('rules file', () => {
  it('loads the sample config without issues', () => {
    const { config, issues } = parseConfigText(SAMPLE);
    expect(issues).toEqual([]);
    expect(config?.rules).toHaveLength(13);
  });

  it('maps rule keys onto engine rules', () => {
    const config = parseConfigText(SAMPLE).config!;
    expect(config.rules[0]).toEqual({
      id: 'pull_request:pr-ready-in-review',
      name: 'PR ready → In Review',
      event: 'pull_request',
      when: {
        action: ['opened', 'reopened', 'ready_for_review', 'synchronize', 'edited'],
        prState: 'open',
        draft: false,
        notLabel: 'skip-jira',
      },
      then: {
        kind: 'transition',
        status: 'In Review',
        via: ['Start review'],
        extras: { linkGithub: 'pull_request' },
      },
    });
    expect(config.rules.find((r) => r.name.startsWith('Quality gate failed (in review)'))).toMatchObject({
      when: { workflow: 'Quality Gate', runEvent: 'pull_request', conclusion: 'failure', jiraStatusIs: 'In Review' },
      then: { onNoTransition: 'qualityGateFailedNoTransition', commentAfterSuccess: 'qualityGateFailed' },
    });
    expect(config.rules.find((r) => r.then.kind === 'deploy')?.then).toMatchObject({
      commentAfterSuccess: 'deploySuccess',
      extras: { linkGithub: 'workflow_run' },
    });
    expect(config.deploy).toEqual({
      jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
      branchToEnvironment: { dev: 'dev', test: 'test', main: 'prod' },
      environmentToJiraStatus: { dev: 'Deployed (Dev)', test: 'Deployed (Test)', prod: 'Done' },
    });
  });

  it('accepts PR branch, label and author filters on review rules', () => {
    const { config } = parseConfigText(
      withRule('name: Reviewed\nwhen: pull_request_review\nif: { action: submitted, baseRef: main, author: octocat }\ncomment: note')
    );
    expect(config?.rules[0]?.when).toEqual({ action: 'submitted', baseRef: 'main', author: 'octocat' });
  });

  it('reports unknown keys with a suggestion and the line', () => {
    const errors = errorsOf(withRule('name: Merged\nwhen: pull_request\ntrasitionTo: Done'));
    const unknown = errors.find((e) => e.message.includes('trasitionTo'));
    expect(unknown?.message).toContain('did you mean "transitionTo"?');
    expect(unknown?.line).toBe(7);
  });

  it('rejects conditions that do not exist on the event', () => {
    const errors = errorsOf(
      withRule('name: Deploy\nwhen: workflow_run\nif: { merged: true }\ncomment: note')
    );
    expect(errors[0]?.message).toContain('"merged" is not available on workflow_run rules');
  });

  it('rejects action values GitHub does not send', () => {
    const errors = errorsOf(
      withRule('name: PR\nwhen: pull_request\nif: { action: synchronise }\ncomment: note')
    );
    expect(errors[0]?.message).toContain('action "synchronise" is not valid on pull_request');
  });

  it('requires exactly one action per rule', () => {
    expect(errorsOf(withRule('name: Two\nwhen: release\ntransitionTo: Done\ncomment: note'))[0]?.message).toContain(
      'found transitionTo and comment'
    );
    expect(errorsOf(withRule('name: None\nwhen: release'))[0]?.message).toContain('needs exactly one of');
  });

  it('rejects step options on the wrong action', () => {
    const errors = errorsOf(withRule('name: Note\nwhen: release\ncomment: note\nvia: Start review'));
    expect(errors[0]?.message).toContain('via only applies with transitionTo');
  });

  it('points unknown message ids at the rule line', () => {
    const errors = errorsOf(withRule('name: Note\nwhen: release\ncomment: missing'));
    expect(errors[0]).toMatchObject({ message: 'Rule "Note" references unknown message "missing"', line: 7 });
  });

  it('reports YAML syntax errors with a line', () => {
    const [error] = errorsOf('projectKey: PROJ\nrules: [\n');
    expect(error?.message).toMatch(/^YAML syntax/);
    expect(error?.line).toBeGreaterThan(0);
  });

  it('explains an unquoted [skip-jira] marker', () => {
    const errors = errorsOf(withRule('name: Note\nwhen: release\ncomment: note', 'options:\n  skipMarker: [skip-jira]\n'));
    expect(errors[0]?.message).toContain(`quote values that start with "["`);
  });

  it('limits deployToJiraStatus and linkGithub to events that support them', () => {
    expect(errorsOf(withRule('name: D\nwhen: pull_request\ndeployToJiraStatus: true'))[0]?.message).toContain(
      'deployToJiraStatus only works on workflow_run rules'
    );
    expect(
      errorsOf(withRule('name: L\nwhen: pull_request\ncomment: note\nlinkGithub: workflow_run'))[0]?.message
    ).toContain('linkGithub "workflow_run" has no URL on pull_request events');
  });

  it('validates the project key and duplicate rule names', () => {
    expect(errorsOf(withRule('name: Note\nwhen: release\ncomment: note').replace('PROJ', 'proj'))[0]?.message).toContain(
      'projectKey must be a Jira project key'
    );
    const twice = `${withRule('name: Note\nwhen: release\ncomment: note')}  - name: note\n    when: release\n    comment: note\n`;
    expect(errorsOf(twice)[0]?.message).toContain('get the same id');
  });

  it('warns about unknown placeholders but still loads', () => {
    const { config, issues } = parseConfigText(
      withRule('name: Note\nwhen: release\ncomment: note').replace('{url}', '{ur}')
    );
    expect(config).not.toBeNull();
    expect(issues).toEqual([expect.objectContaining({ level: 'warning', message: expect.stringContaining('{ur}') })]);
  });

  it('only posts the default no-transition comment when that message exists', () => {
    const { config } = parseConfigText(withRule('name: Done\nwhen: release\ntransitionTo: Done'));
    expect(config?.options.noTransitionMessageId).toBeNull();
  });
});

describe('JSON schema', () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(buildConfigSchema());

  it('accepts the sample config', () => {
    const valid = validate(parseYaml(SAMPLE));
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('rejects configs the loader rejects', () => {
    const invalid = [
      withRule('name: M\nwhen: pull_request\ntrasitionTo: Done'),
      withRule('name: D\nwhen: workflow_run\nif: { merged: true }\ncomment: note'),
      withRule('name: P\nwhen: pull_request\nif: { action: synchronise }\ncomment: note'),
      withRule('name: T\nwhen: release\ntransitionTo: Done\ncomment: note'),
      withRule('name: V\nwhen: release\ncomment: note\nvia: Start review'),
    ];
    for (const yaml of invalid) {
      expect(validate(parseYaml(yaml)), yaml).toBe(false);
    }
  });

  it('matches the committed jira-sync.config.schema.json', () => {
    const committed = JSON.parse(readFileSync('jira-sync.config.schema.json', 'utf8'));
    expect(committed).toEqual(buildConfigSchema());
  });
});
