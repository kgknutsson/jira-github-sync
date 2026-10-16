/**
 * Public config API — re-exports the declarative DSL used by `settings.ts`.
 *
 * **Documentation:** Every GitHub enum in {@link syncCatalog} uses the same JSDoc shape:
 * GitHub source → use with → `@example` blocks. Hover `When`, `If`, `PrAct`, etc. in the editor.
 *
 * **Repo-owned strings** (Jira, workflows, messages) stay inline in `settings.ts` — not exported here.
 *
 * @module config
 */
export { config } from './dsl';
export type {
  BuiltSyncConfig,
  DeployMeta,
  GitHubEventKind,
  MessageTemplateId,
  RuleStep,
  SyncRule,
} from './types';
export type {
  CheckSuiteWhenBuilder,
  PullRequestWhenBuilder,
  PullRequestReviewWhenBuilder,
  ReleaseWhenBuilder,
  SyncWhenBuilder,
  WorkflowRunWhenBuilder,
} from './dsl';
export { jiraStatusNamesFromConfig } from './jiraConfigLabels';
export type { JiraStatusName, JiraTransitionName } from './jiraConfigLabels';
export {
  CheckEnd,
  DEPLOY_FAIL_ENDS,
  DeployState,
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
