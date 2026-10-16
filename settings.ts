/**
 * Jira sync rules — **primary file to edit** when changing automation.
 *
 * ## Boundary
 *
 * | Layer | Where | Examples |
 * | ----- | ----- | -------- |
 * | GitHub (standard) | `lib/config/syncCatalog.ts` | `PrAct`, `RunEnd`, `If`, `When` |
 * | This repo | **this file** | Jira status/transition strings, workflow names, messages, deploy maps, rules |
 *
 * GitHub Actions events are parsed by the engine; rules use **plain strings** for Jira,
 * workflow `name:` values, and comment template ids (never enums in `syncCatalog`).
 *
 * Rebuild after edits: `node build.mjs`.
 *
 * **How to write rules:** [authoring-guide.md](./authoring-guide.md)
 *
 * @module settings

/**
 * GitHub enums — hover `When`, `If`, `PrAct`, `RunEnd`, … for unified docs + `@example` rule fragments.
 * Jira/workflow/message values in this file are plain strings only.
 */
import {
  config,
  If,
  Pr,
  PrAct,
  ReleaseAct,
  Review,
  ReviewAct,
  RunEnd,
  RunTrigger,
  When,
} from './lib/config';

/** Compiled sync rules consumed by `run.ts` and static audits. */
export const builtSyncConfig = config('PROJ')
  .options({
    resolveKeyFromCommitMessage: true,
    processAllMatchingIssueKeys: false,
    failOnJiraError: true,
    skipMarker: '[skip-jira]',
  })
  .messages({
    merged: 'Pull request merged to {baseRef}: {url}',
    prApproved: 'Pull request approved on GitHub: {url}',
    deploySuccess: 'Deployed to {env} via GitHub Actions: {url}',
    deploySuccessAlreadyOnStatus: 'Deploy to {env} succeeded (already on {status}): {url}',
    deployFailed: 'Deploy workflow failed: {url}',
    qualityGateSuccess: 'Quality Gate passed: {url}',
    qualityGateFailed: 'Quality Gate failed: {url}',
    qualityGateFailedNoTransition:
      'Quality Gate failed but issue could not move to {targetStatus} from "{currentStatus}": {url}',
    noTransition:
      'GitHub Actions could not move this issue from "{currentStatus}" to "{targetStatus}". Run: {url}',
    releasePublished: 'GitHub release {releaseTag} published: {url}',
  })
  .deploy({
    jobNameRegex: String.raw`Build and Deploy \((dev|test|prod)\)`,
    branchToEnvironment: {
      dev: 'dev',
      test: 'test',
      main: 'prod',
    },
    environmentToJiraStatus: {
      dev: 'Deployed (Dev)',
      test: 'Deployed (Test)',
      prod: 'Done',
    },
  })

  .when(When.PullRequest)
  .named('PR ready → In Review')
  .if(If.Action, PrAct.Opened, PrAct.Reopened, PrAct.ReadyForReview, PrAct.Synchronize, PrAct.Edited)
  .if(If.PrState, Pr.Open)
  .ifNot(If.Draft)
  .if(If.NotLabel, 'skip-jira')
  .transitionTo('In Review', { via: ['Start review'], extras: { linkGithub: 'pull_request' } })

  .when(When.PullRequest)
  .named('PR opened as draft → In Progress')
  .if(If.Action, PrAct.Opened)
  .if(If.PrState, Pr.Open)
  .if(If.Draft, true)
  .transitionTo('In Progress', { via: ['Rework'] })

  .when(When.PullRequest)
  .named('PR draft → In Progress')
  .if(If.Action, PrAct.ConvertedToDraft)
  .if(If.PrState, Pr.Open)
  .transitionTo('In Progress', { via: ['Rework'] })

  .when(When.PullRequest)
  .named('PR merged to main → Done')
  .if(If.Action, PrAct.Closed)
  .if(If.PrState, Pr.Closed)
  .if(If.Merged, true)
  .if(If.BaseRef, 'main')
  .transitionTo('Done', { extras: { linkGithub: 'pull_request' } })

  .when(When.PullRequest)
  .named('PR merged → comment')
  .if(If.Action, PrAct.Closed)
  .if(If.PrState, Pr.Closed)
  .if(If.Merged, true)
  .comment('merged', { extras: { linkGithub: 'pull_request' } })

  .when(When.PullRequestReview)
  .named('Changes requested → In Progress')
  .if(If.Action, ReviewAct.Submitted)
  .if(If.PrState, Pr.Open)
  .if(If.ReviewState, Review.ChangesRequested)
  .transitionTo('In Progress', { via: ['Request changes'] })

  .when(When.PullRequestReview)
  .named('PR approved → comment')
  .if(If.Action, ReviewAct.Submitted)
  .if(If.PrState, Pr.Open)
  .if(If.ReviewState, Review.Approved)
  .comment('prApproved')

  .when(When.WorkflowRun)
  .named('Deploy success → environment status')
  .if(If.Workflow, 'Deploy')
  .if(If.Conclusion, RunEnd.Success)
  .deployToJiraStatus({
    commentAfterSuccess: 'deploySuccess',
    commentWhenSkipped: 'deploySuccessAlreadyOnStatus',
    extras: { linkGithub: 'workflow_run' },
  })

  .when(When.WorkflowRun)
  .named('Deploy failed → comment')
  .if(If.Workflow, 'Deploy')
  .if(If.Conclusion, RunEnd.Failure, RunEnd.Cancelled, RunEnd.TimedOut)
  .comment('deployFailed')

  .when(When.WorkflowRun)
  .named('Quality gate failed (in review) → In Progress')
  .if(If.Workflow, 'Quality Gate')
  .if(If.RunEvent, RunTrigger.PullRequest)
  .if(If.Conclusion, RunEnd.Failure)
  .ifJiraStatus('In Review')
  .transitionTo('In Progress', {
    via: ['Rework'],
    onNoTransition: 'qualityGateFailedNoTransition',
    commentAfterSuccess: 'qualityGateFailed',
  })

  .when(When.WorkflowRun)
  .named('Quality gate failed → comment only')
  .if(If.Workflow, 'Quality Gate')
  .if(If.RunEvent, RunTrigger.PullRequest)
  .if(If.Conclusion, RunEnd.Failure)
  .unlessJiraStatus('In Review')
  .comment('qualityGateFailed')

  .when(When.WorkflowRun)
  .named('Quality gate success → comment')
  .if(If.Workflow, 'Quality Gate')
  .if(If.RunEvent, RunTrigger.PullRequest)
  .if(If.Conclusion, RunEnd.Success)
  .comment('qualityGateSuccess')

  .when(When.Release)
  .named('Release published → comment')
  .if(If.Action, ReleaseAct.Published)
  .comment('releasePublished', { extras: { linkGithub: 'release' } })

  .build();
