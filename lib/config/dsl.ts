/**
 * Fluent DSL for building {@link BuiltSyncConfig} in `settings.ts`.
 *
 * **GitHub fields:** `.when({@link When})` / `.if({@link If}, {@link PrAct} | strings)` — see
 * {@link syncCatalog} (each enum member documents GitHub source + examples).
 *
 * **Repo strings:** Jira columns, workflow names, `.messages({ … })`, template ids in rules.
 *
 * @module config/dsl
 *
 * @example Minimal rule chain
 * ```ts
 * config('PROJ')
 *   .messages({ merged: 'Merged: {url}' })
 *   .when(When.PullRequest)
 *   .if(If.Action, PrAct.Closed)
 *   .if(If.Merged, true)
 *   .comment('merged')
 *   .build()
 * ```
 */
import type {
  BuiltSyncConfig,
  DeployMeta,
  GitHubEventKind,
  MessageTemplateId,
  RuleConditions,
  RuleStep,
  SyncRule,
} from './types';
import { DEFAULT_SYNC_OPTIONS, type SyncOptions } from './syncOptions';
import {
  CheckEnd,
  If,
  Pr,
  PrAct,
  ReleaseAct,
  Review,
  ReviewAct,
  RunEnd,
  RunTrigger,
  When,
} from './syncCatalog';
import type { JiraStepExtras } from './jiraStepExtras';
import type { JiraStatusName, JiraTransitionName } from './jiraConfigLabels';

type TransitionOptions = {
  via?: readonly JiraTransitionName[];
  onNoTransition?: MessageTemplateId;
  commentAfterSuccess?: MessageTemplateId;
  commentWhenSkipped?: MessageTemplateId;
  extras?: JiraStepExtras;
};

type DeployOptions = {
  onNoTransition?: MessageTemplateId;
  commentAfterSuccess?: MessageTemplateId;
  commentWhenSkipped?: MessageTemplateId;
  extras?: JiraStepExtras;
};

type CommentOptions = {
  extras?: JiraStepExtras;
};

type RuleFinishBuilder = {
  transitionTo(jiraStatus: JiraStatusName, options?: TransitionOptions): ConfigBuilder;
  deployToJiraStatus(options?: DeployOptions): ConfigBuilder;
  comment(messageKey: MessageTemplateId, options?: CommentOptions): ConfigBuilder;
};

type JiraWhenClause = {
  ifJiraStatus(status: JiraStatusName): RuleFinishBuilder & JiraWhenClause;
  unlessJiraStatus(status: JiraStatusName): RuleFinishBuilder & JiraWhenClause;
};

export type PullRequestWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): PullRequestWhenBuilder;
    if(field: If.Action, ...values: PrAct[]): PullRequestWhenBuilder;
    if(field: If.PrState, ...values: Pr[]): PullRequestWhenBuilder;
    if(field: If.Merged, value: boolean): PullRequestWhenBuilder;
    if(field: If.Draft, value: boolean): PullRequestWhenBuilder;
    if(field: If.BaseRef, ...values: string[]): PullRequestWhenBuilder;
    if(field: If.HeadRef, ...values: string[]): PullRequestWhenBuilder;
    if(field: If.Label, ...values: string[]): PullRequestWhenBuilder;
    if(field: If.NotLabel, ...values: string[]): PullRequestWhenBuilder;
    if(field: If.Author, ...values: string[]): PullRequestWhenBuilder;
    ifNot(field: If.Draft, value?: true): PullRequestWhenBuilder;
  };

export type PullRequestReviewWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): PullRequestReviewWhenBuilder;
    if(field: If.Action, ...values: ReviewAct[]): PullRequestReviewWhenBuilder;
    if(field: If.ReviewState, ...values: Review[]): PullRequestReviewWhenBuilder;
    if(field: If.PrState, ...values: Pr[]): PullRequestReviewWhenBuilder;
    if(field: If.BaseRef, ...values: string[]): PullRequestReviewWhenBuilder;
    if(field: If.HeadRef, ...values: string[]): PullRequestReviewWhenBuilder;
    if(field: If.Label, ...values: string[]): PullRequestReviewWhenBuilder;
    if(field: If.NotLabel, ...values: string[]): PullRequestReviewWhenBuilder;
    if(field: If.Author, ...values: string[]): PullRequestReviewWhenBuilder;
  };

export type WorkflowRunWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): WorkflowRunWhenBuilder;
    if(field: If.Workflow, ...values: string[]): WorkflowRunWhenBuilder;
    if(
      field: If.RunEvent,
      ...values: (RunTrigger | string)[]
    ): WorkflowRunWhenBuilder;
    if(field: If.Conclusion, ...values: RunEnd[]): WorkflowRunWhenBuilder;
  };

/** {@link When.CheckSuite} and {@link When.CheckRun} rules. */
export type CheckSuiteWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): CheckSuiteWhenBuilder;
    if(field: If.Action, ...values: string[]): CheckSuiteWhenBuilder;
    if(field: If.CheckName, ...values: string[]): CheckSuiteWhenBuilder;
    if(field: If.Conclusion, ...values: (RunEnd | CheckEnd)[]): CheckSuiteWhenBuilder;
  };

/** {@link When.Release} rules. */
export type ReleaseWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): ReleaseWhenBuilder;
    if(field: If.Action, ...values: ReleaseAct[]): ReleaseWhenBuilder;
    if(field: If.ReleaseTag, ...values: string[]): ReleaseWhenBuilder;
  };

/** Builder for any {@link When} event (generic `.if(If, …)` with string/boolean values). */
export type SyncWhenBuilder = RuleFinishBuilder &
  JiraWhenClause & {
    named(name: string): SyncWhenBuilder;
    if(field: If, ...values: (string | boolean)[]): SyncWhenBuilder;
    ifNot(field: If.Draft): SyncWhenBuilder;
  };

class ConfigBuilder {
  private rules: SyncRule[] = [];
  private messageTemplates: Record<string, string> = {};
  private syncOptions: SyncOptions = { ...DEFAULT_SYNC_OPTIONS };
  private deployMeta: DeployMeta = {
    jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
    branchToEnvironment: {},
    environmentToJiraStatus: {},
  };

  constructor(private projectKey: string) {}

  messages(map: Readonly<Record<string, string>>): this {
    this.messageTemplates = { ...map };
    return this;
  }

  deploy(meta: DeployMeta): this {
    this.deployMeta = meta;
    return this;
  }

  options(partial: Partial<SyncOptions>): this {
    this.syncOptions = { ...this.syncOptions, ...partial };
    return this;
  }

  when(event: When.PullRequest): PullRequestWhenBuilder;
  when(event: When.PullRequestReview): PullRequestReviewWhenBuilder;
  when(event: When.WorkflowRun): WorkflowRunWhenBuilder;
  when(event: When.CheckSuite): CheckSuiteWhenBuilder;
  when(event: When.CheckRun): CheckSuiteWhenBuilder;
  when(event: When.Release): ReleaseWhenBuilder;
  when(event: When): SyncWhenBuilder;
  when(event: When): SyncWhenBuilder {
    const eventKind = event as GitHubEventKind;
    const conditions: RuleConditions = {};
    const ruleIndex = this.rules.length + 1;
    let ruleId = `${eventKind}-${ruleIndex}`;
    let ruleName = `${eventKind} #${ruleIndex}`;

    const finish = (step: RuleStep): ConfigBuilder => {
      this.rules.push({
        id: ruleId,
        name: ruleName,
        event: eventKind,
        when: { ...conditions },
        then: step,
      });
      return this;
    };

    const builder = {
      named(name: string) {
        ruleName = name;
        ruleId = `${eventKind}:${slugify(name)}`;
        return builder;
      },
      if(field: If, ...values: (string | boolean)[]) {
        const key = field as keyof RuleConditions;
        if (field === If.Draft && values.length === 1 && values[0] === false) {
          conditions.notDraft = true;
          return builder;
        }
        if (values.length === 1) {
          (conditions as Record<string, unknown>)[key] = values[0];
        } else {
          (conditions as Record<string, unknown>)[key] = values as string[];
        }
        return builder;
      },
      ifNot(field: If) {
        if (field === If.Draft) conditions.notDraft = true;
        return builder;
      },
      ifJiraStatus(status: JiraStatusName) {
        conditions.jiraStatusIs = status;
        return builder;
      },
      unlessJiraStatus(status: JiraStatusName) {
        conditions.jiraStatusIsNot = status;
        return builder;
      },
      transitionTo(status: JiraStatusName, options: TransitionOptions = {}) {
        return finish({
          kind: 'transition',
          status,
          via: options.via,
          onNoTransition: options.onNoTransition,
          commentAfterSuccess: options.commentAfterSuccess,
          commentWhenSkipped: options.commentWhenSkipped,
          extras: options.extras,
        });
      },
      deployToJiraStatus(options: DeployOptions = {}) {
        return finish({
          kind: 'deploy',
          onNoTransition: options.onNoTransition,
          commentAfterSuccess: options.commentAfterSuccess,
          commentWhenSkipped: options.commentWhenSkipped,
          extras: options.extras,
        });
      },
      comment(messageKey: MessageTemplateId, options: CommentOptions = {}) {
        return finish({ kind: 'comment', messageKey, extras: options.extras });
      },
    };

    return builder as SyncWhenBuilder;
  }

  build(): BuiltSyncConfig {
    return {
      projectKey: this.projectKey,
      messages: this.messageTemplates,
      deploy: this.deployMeta,
      rules: this.rules,
      options: this.syncOptions,
    };
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Start configuration: `config(projectKey).messages(...).when(When.…).build()` */
export function config(projectKey: string): ConfigBuilder {
  return new ConfigBuilder(projectKey);
}
