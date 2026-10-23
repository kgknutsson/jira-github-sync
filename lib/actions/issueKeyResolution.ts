/**
 * Resolves Jira issue keys from GitHub commits, PRs, and branch names.
 *
 * @module actions/issueKeyResolution
 */
import {
  findPullRequestsForCommitBestEffort,
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

function keysFromPayloadMessages(
  commitMessages: string[],
  extractAll: (parts: IssueKeyParts) => string[],
  skipMarker: string | null
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const message of commitMessages) {
    if (skipMarker && textContainsSkipMarker(message, skipMarker)) continue;
    for (const key of extractAll({ commitMessage: message })) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
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
  if (commitMessage === undefined) {
    commitMessage = await getCommitMessage(gh, headSha);
  }

  if (options.skipMarker && textContainsSkipMarker(commitMessage ?? '', options.skipMarker)) {
    log.info(`Skip marker in commit ${headSha.slice(0, 7)}; ignoring for issue keys`);
    return [];
  }

  const prs = await findPullRequestsForCommitBestEffort(gh, headSha);
  if (
    options.skipMarker &&
    prs.some((pr) =>
      [pr.title, pr.body ?? '', pr.headRef].some((t) => textContainsSkipMarker(t, options.skipMarker))
    )
  ) {
    log.info(`Skip marker on a PR linked to ${headSha.slice(0, 7)}; ignoring commit for issue keys`);
    return [];
  }

  const keys: string[] = [];
  if (resolveKeyFromCommitMessage) {
    mergeUnique(keys, extractAll({ commitMessage }));
    if (!collectAll && keys.length > 0) return keys;
  }

  for (const pr of prs) {
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

type ScanResult = { keys: string[]; listFailed: boolean };

async function scanRecentCommitKeys(
  headSha: string,
  headBranch: string,
  extractAll: (parts: IssueKeyParts) => string[],
  options: ResolveOptions
): Promise<ScanResult> {
  const scanOptions = {
    skipMarker: options.skipMarker,
    useBranchFallback: false,
  };
  const gh = readGitHubAuthFromEnv();
  if (!gh) {
    log.info('GITHUB_TOKEN not set; recent-commit issue key scan skipped');
    return { keys: [], listFailed: true };
  }

  const { commits, ok } = await listRecentCommitsOnBranch(gh, headSha, {
    limit: options.resolveKeysFromRecentCommits,
  });
  if (!ok) {
    return { keys: [], listFailed: true };
  }

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

  if (keys.length > 0) return { keys, listFailed: false };

  const headKeys = await keysForCommitSha(
    headSha,
    headBranch,
    extractAll,
    options.resolveKeyFromCommitMessage,
    true,
    scanOptions
  );
  return { keys: headKeys, listFailed: false };
}

/** Resolve issue key(s) for workflow_run (PRs, commit message, branch). */
export async function resolveIssueKeysForWorkflowRun(
  headSha: string,
  headBranch: string,
  extractAll: (parts: IssueKeyParts) => string[],
  options: ResolveOptions
): Promise<string[]> {
  if (shouldScanRecentCommits(options)) {
    const { keys, listFailed } = await scanRecentCommitKeys(headSha, headBranch, extractAll, options);
    if (listFailed) {
      return keysForCommitSha(
        headSha,
        headBranch,
        extractAll,
        options.resolveKeyFromCommitMessage,
        true,
        { skipMarker: options.skipMarker, useBranchFallback: false }
      );
    }
    return keys;
  }

  return keysForCommitSha(
    headSha,
    headBranch,
    extractAll,
    options.resolveKeyFromCommitMessage,
    false,
    { skipMarker: options.skipMarker, useBranchFallback: true }
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
    const { keys, listFailed } = await scanRecentCommitKeys(headSha, branch, extractAll, options);
    if (listFailed) {
      const fromPayload = keysFromPayloadMessages(
        commitMessagesFromPayload,
        extractAll,
        options.skipMarker
      );
      if (fromPayload.length > 0) return fromPayload;
      return keysForCommitSha(
        headSha,
        branch,
        extractAll,
        options.resolveKeyFromCommitMessage,
        true,
        { skipMarker: options.skipMarker, useBranchFallback: false }
      );
    }
    return keys;
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
