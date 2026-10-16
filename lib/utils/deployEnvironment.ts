/**
 * Infers deploy target (`dev` / `test` / `prod`) from workflow job names or branch.
 *
 * @module utils/deployEnvironment
 */

/** Minimal job row from GitHub Actions jobs API. */
export type WorkflowJobSummary = { name: string };

/**
 * Resolves deploy environment key from job name regex match, else branch map.
 *
 * @param validEnvKeys - Keys of `environmentToJiraStatus` (used to validate capture group)
 */
export function parseDeployEnvironment(
  jobs: WorkflowJobSummary[],
  headBranch: string | null | undefined,
  jobNamePattern: RegExp,
  branchToEnv: Record<string, string>,
  validEnvKeys: Record<string, string>,
  options?: { allowBranchFallback?: boolean }
): string | null {
  for (const job of jobs) {
    const match = job.name.match(jobNamePattern);
    if (match?.[1] && match[1] in validEnvKeys) {
      return match[1];
    }
  }

  if (options?.allowBranchFallback === false) {
    return null;
  }

  const branch = (headBranch ?? '').trim();
  return branchToEnv[branch] ?? null;
}
