/**
 * Compiles declarative `settings.ts` output into runtime helpers (regexes, lookups).
 *
 * @module config/compileConfig
 */
import type { BuiltSyncConfig } from './types';
import { DEFAULT_SYNC_OPTIONS } from './syncOptions';
import { assertValidConfig } from './validateConfig';

/**
 * Runtime helpers derived from built user config (`settings.ts`).
 *
 * @param validate - When true (default), throws on config errors via {@link assertValidConfig}
 */
export function compileConfig(built: BuiltSyncConfig, validate = true) {
  if (validate) assertValidConfig(built);

  const options = { ...DEFAULT_SYNC_OPTIONS, ...built.options };
  const projectKey = built.projectKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Not `\b`: keys must still match next to `_` (e.g. branch `PROJ-12_fix`).
  const issueKeyPattern = new RegExp(
    String.raw`(?<![A-Za-z0-9])${projectKey}-\d+(?![0-9])`,
    'gi'
  );

  return {
    built: { ...built, options },
    projectKey: built.projectKey,
    options,
    issueKeyPattern,
    deployJobPattern: built.deploy.jobNameRegex ? new RegExp(built.deploy.jobNameRegex) : null,
    deployEnvToStatus: built.deploy.environmentToJiraStatus,
    branchToDeployEnv: built.deploy.branchToEnvironment,
    messageTemplate(key: string): string {
      const t = built.messages[key];
      if (!t) throw new Error(`Unknown message key: ${key}`);
      return t;
    },
  };
}

/** Cached regexes and lookups from {@link compileConfig}. */
export type CompiledSyncConfig = ReturnType<typeof compileConfig>;
