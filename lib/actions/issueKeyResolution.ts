/**
 * Resolves Jira issue keys from GitHub commits, PRs, and branch names.
 *
 * @module actions/issueKeyResolution
 */
import {
  findPullRequestsForCommit,
  getCommitMessage,
  listRecentCommitsOnBranch,
  readGitHubAuthFromEnv,
} from '../adapters/github/api';
import { textContainsSkipMarker } from '../utils/issueKey';
import { log } from '../utils/logger';

export type IssueKeyParts = {
  title?: string | null;
  branch?: string | null;
  body?: string | null;
  commitMessage?: string | null;
};

type ResolveOptions = {
  resolveKeyFromCommitMessage: boolean;
  resolveKeysFromRecentCommits: number;
  allowRecentCommitScan: boolean;
  skipMarker: string | null;
};

function shouldScanRecentCommits(options: ResolveOptions): boolean {
  return options.allowRecentCommitScan && options.resolveKeysFromRecentCommits > 0;
}

function mergeUnique(into: string[], keys: string[]): string[] {
  const seen = new Set(into);
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      into.push(key);
    }
  }
  return into;
}

async function keysForCommitSha(
  headSha: string,
  headBranch: string,
  extractAll: (parts: IssueKeyParts) => string[],
  resolveKeyFromCommitMessage: boolean,
  collectAll: boolean,
  options: {
    knownCommitMessage?: string | null;
    useBranchFallback: boolean;
    skipMarker: string | null;
  }
): Promise<string[]> {
  const gh = readGitHubAuthFromEnv();
  if (!gh) {
    return options.useBranchFallback ? extractAll({ branch: headBranch }) : [];
  }

  let commitMessage: string | null | undefined = options.knownCommitMessage;
  if (resolveKeyFromCommitMessage) {
    if (commitMessage === undefined) {
      commitMessage = await getCommitMessage(gh, headSha);
    }
    if (options.skipMarker && textContainsSkipMarker(commitMessage ?? '', options.skipMarker)) {
      log.info(`Skip marker in commit ${headSha.slice(0, 7)}; ignoring for issue keys`);
      return [];
    }
    const fromMessage = extractAll({ commitMessage });
    if (fromMessage.length > 0) {
      return fromMessage;
    }
  }

  const prs = await findPullRequestsForCommit(gh, headSha);
  const keys: string[] = [];
  for (const pr of prs) {
    const prTexts = [pr.title, pr.body ?? '', pr.headRef];
    if (options.skipMarker && prTexts.some((t) => textContainsSkipMarker(t, options.skipMarker))) {
      log.info(`Skip marker on PR linked to ${headSha.slice(0, 7)}; ignoring that PR for issue keys`);
      continue;
    }
    const fromPr = extractAll({
      title: pr.title,
      body: pr.body,
      branch: pr.headRef,
    });
    if (fromPr.length > 0) {
      if (collectAll) mergeUnique(keys, fromPr);
      else return fromPr;
    }
  }

  if (keys.length > 0) return keys;
  if (options.useBranchFallback) {
    return extractAll({ branch: headBranch });
  }
  return [];
}

/** Resolve issue key(s) for workflow_run (PRs, commit message, branch). */
export async function resolveIssueKeysForWorkflowRun(
  headSha: string,
  headBranch: string,
  extractAll: (parts: IssueKeyParts) => string[],
  options: ResolveOptions
): Promise<string[]> {
  const scanOptions = {
    skipMarker: options.skipMarker,
    useBranchFallback: false,
  };

  if (shouldScanRecentCommits(options)) {
    const gh = readGitHubAuthFromEnv();
    if (!gh) {
      log.info('GITHUB_TOKEN not set; recent-commit issue key scan skipped');
      return keysForCommitSha(
        headSha,
        headBranch,
        extractAll,
        options.resolveKeyFromCommitMessage,
        true,
        { ...scanOptions, useBranchFallback: true }
      );
    }

    const commits = await listRecentCommitsOnBranch(gh, headSha, {
      limit: options.resolveKeysFromRecentCommits,
    });
    log.info(
      `Scanning ${commits.length} commit(s) on ${headBranch} for issue keys (limit ${options.resolveKeysFromRecentCommits})`
    );

    const keys: string[] = [];
    const seen = new Set<string>();
    for (const commit of commits) {
      const fromCommit = await keysForCommitSha(
        commit.sha,
        headBranch,
        extractAll,
        options.resolveKeyFromCommitMessage,
        true,
        { ...scanOptions, knownCommitMessage: commit.message }
      );
      for (const key of fromCommit) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    if (keys.length > 0) return keys;
    return keysForCommitSha(
      headSha,
      headBranch,
      extractAll,
      options.resolveKeyFromCommitMessage,
      true,
      scanOptions
    );
  }

  return keysForCommitSha(
    headSha,
    headBranch,
    extractAll,
    options.resolveKeyFromCommitMessage,
    false,
    { ...scanOptions, useBranchFallback: true }
  );
}

/** Keys from a push webhook (plus API scan when the payload omits commits). */
export async function resolveIssueKeysForPush(
  headSha: string,
  branch: string,
  commitMessagesFromPayload: string[],
  extractAll: (parts: IssueKeyParts) => string[],
  options: ResolveOptions
): Promise<string[]> {
  if (shouldScanRecentCommits(options)) {
    return resolveIssueKeysForWorkflowRun(headSha, branch, extractAll, options);
  }

  const fromPayload = extractAll({
    branch,
    commitMessage: commitMessagesFromPayload.join('\n'),
  });
  if (fromPayload.length > 0) return fromPayload;
  return keysForCommitSha(
    headSha,
    branch,
    extractAll,
    options.resolveKeyFromCommitMessage,
    false,
    { skipMarker: options.skipMarker, useBranchFallback: true }
  );
}
