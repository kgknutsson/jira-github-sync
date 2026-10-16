/**
 * Resolves jira-sync **package root** vs **consumer repo root** (host that runs Actions).
 *
 * - Standalone `jira-github-sync` repo: both are the same directory.
 * - Vendored: package under `.github/workflows/jira-sync/`, consumer is repo root.
 *
 * @module audit/repoPaths
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cwd = () => process.cwd();

/** Host repository root (where `jira-sync.yml` usually lives). */
export function consumerRoot(): string {
  return cwd();
}

/** Directory containing `settings.ts` and `package.json` for this package. */
export function packageRoot(): string {
  const root = cwd();
  const candidates = [root, join(root, '.github/workflows/jira-sync')];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'settings.ts')) && existsSync(join(dir, 'package.json'))) {
      return dir;
    }
  }
  throw new Error(
    'jira-sync package root not found (expected settings.ts + package.json at repo root or .github/workflows/jira-sync/)'
  );
}

export function readPackageFile(relativePath: string): string {
  return readFileSync(join(packageRoot(), relativePath), 'utf8');
}

export function readConsumerFile(relativePath: string): string {
  return readFileSync(join(consumerRoot(), relativePath), 'utf8');
}

export function consumerFileExists(relativePath: string): boolean {
  return existsSync(join(consumerRoot(), relativePath));
}
