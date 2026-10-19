/**
 * Builds the JSON Schema for the rules file from the catalog, so editor validation matches what
 * the action enforces. `node build.mjs` writes it to `jira-sync.config.schema.json`.
 *
 * @module config/configSchema
 */
import {
  CONDITIONS,
  EVENT_ACTIONS,
  EVENT_NAMES,
  EVENTS,
  LINK_KINDS,
  PLACEHOLDERS,
  type ConditionKey,
} from './catalog';
import type { GitHubEventKind } from './types';

/** Raw URL of the published schema (`# yaml-language-server: $schema=…` in rules files). */
export const CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/kgknutsson/jira-github-sync/v1/jira-sync.config.schema.json';

type Schema = Record<string, unknown>;

function textOrList(description: string, values?: readonly string[]): Schema {
  const item: Schema = values ? { type: 'string', enum: [...values] } : { type: 'string', minLength: 1 };
  return { description, anyOf: [item, { type: 'array', items: item, minItems: 1 }] };
}

function conditionsFor(event: GitHubEventKind): Schema {
  const keys = (Object.keys(CONDITIONS) as ConditionKey[]).filter((key) =>
    CONDITIONS[key].events.includes(event)
  );
  return {
    type: 'object',
    description: `Conditions on the ${event} event; all must match.`,
    additionalProperties: false,
    properties: Object.fromEntries(
      keys.map((key) => {
        const spec = CONDITIONS[key];
        if (spec.type === 'boolean') return [key, { type: 'boolean', description: spec.description }];
        const values = spec.values === 'action' ? EVENT_ACTIONS[event] : spec.values;
        return [key, textOrList(spec.description, values)];
      })
    ),
  };
}

const messageId = (description: string): Schema => ({ type: 'string', minLength: 1, description });

/** JSON Schema (draft-07) describing `.github/jira-sync.config.yml`. */
export function buildConfigSchema(): Schema {
  const placeholderList = Object.keys(PLACEHOLDERS)
    .map((name) => `{${name}}`)
    .join(', ');
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: CONFIG_SCHEMA_URL,
    title: 'jira-github-sync rules',
    description: 'Rules that move Jira issues and post comments from GitHub events.',
    type: 'object',
    additionalProperties: false,
    required: ['projectKey', 'rules'],
    properties: {
      projectKey: {
        type: 'string',
        pattern: '^[A-Z][A-Z0-9_]*$',
        description: 'Jira project key; issue keys look like PROJ-123.',
      },
      options: {
        type: 'object',
        additionalProperties: false,
        description: 'Runtime behavior.',
        properties: {
          resolveKeyFromCommitMessage: {
            type: 'boolean',
            description: 'workflow_run / check / deployment events: also read keys from the head commit message. Default true.',
          },
          processAllMatchingIssueKeys: {
            type: 'boolean',
            description: 'Apply the matched rule to every issue key found instead of only the first. Default false.',
          },
          failOnJiraError: {
            type: 'boolean',
            description: 'Fail the job on Jira API errors (missing issues are always skipped). Default true.',
          },
          skipMarker: {
            type: ['string', 'null'],
            description: "Skip events whose PR/commit/comment text contains this (case-insensitive). Default '[skip-jira]'; quote it.",
          },
          noTransitionMessageId: {
            type: ['string', 'null'],
            description: 'Message posted when Jira has no transition to the target status. Default noTransition when that message exists.',
          },
        },
      },
      messages: {
        type: 'object',
        description: `Comment templates by id. Placeholders: ${placeholderList}.`,
        additionalProperties: { type: 'string' },
      },
      deploy: {
        type: 'object',
        additionalProperties: false,
        description: 'Maps deploy runs to Jira statuses for deployToJiraStatus rules.',
        properties: {
          jobNameRegex: {
            type: 'string',
            description: 'Regex on deploy job names; capture group 1 is the environment, e.g. Build and Deploy \\((dev|prod)\\).',
          },
          branchToEnvironment: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Fallback for push-triggered runs when no job name matches: branch → environment.',
          },
          environmentToJiraStatus: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment → exact Jira status name.',
          },
        },
      },
      rules: {
        type: 'array',
        minItems: 1,
        description: 'Checked top to bottom; the first matching rule runs.',
        items: { $ref: '#/definitions/rule' },
      },
    },
    definitions: {
      rule: {
        type: 'object',
        required: ['name', 'when'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, description: 'Unique label shown in the job log.' },
          when: {
            enum: EVENT_NAMES,
            description: EVENT_NAMES.map((event) => `${event}: ${EVENTS[event]}`).join('\n'),
          },
          if: { type: 'object', description: 'Conditions on the GitHub event; all must match.' },
          ifJiraStatus: { type: 'string', minLength: 1, description: 'Only when the issue is in this Jira status.' },
          unlessJiraStatus: { type: 'string', minLength: 1, description: 'Skip when the issue is in this Jira status.' },
          transitionTo: { type: 'string', minLength: 1, description: 'Move the issue to this exact Jira status.' },
          deployToJiraStatus: {
            const: true,
            description: 'workflow_run only: move the issue to the status mapped for the deployed environment (see deploy).',
          },
          comment: messageId('Post this message (id from messages).'),
          via: textOrList('transitionTo only: transition names to prefer when several lead to the status.'),
          onNoTransition: messageId('Message when no transition leads to the status (overrides options.noTransitionMessageId).'),
          commentAfterSuccess: messageId('Message posted after a successful transition.'),
          commentWhenSkipped: messageId('Message posted when the issue is already in the status.'),
          commentOnIssue: {
            type: 'boolean',
            description:
              'Set true on transition/deploy rules to post commentAfterSuccess, commentWhenSkipped, or onNoTransition. Comment-only rules post by default; set false to skip.',
          },
          linkGithub: {
            enum: Object.keys(LINK_KINDS),
            description: 'Add (or update) a Jira web link to the pull request, workflow run or release.',
          },
          fields: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Set Jira fields (id → value template), e.g. customfield_10042: "{prUrl}".',
          },
        },
        oneOf: [
          { required: ['transitionTo'] },
          { required: ['deployToJiraStatus'] },
          { required: ['comment'] },
        ],
        dependencies: { via: ['transitionTo'] },
        allOf: EVENT_NAMES.map((event) => ({
          if: { properties: { when: { const: event } }, required: ['when'] },
          then: { properties: { if: { $ref: `#/definitions/if_${event}` } } },
        })),
      },
      ...Object.fromEntries(EVENT_NAMES.map((event) => [`if_${event}`, conditionsFor(event)])),
    },
  };
}
