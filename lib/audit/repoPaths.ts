/**
 * Resolves jira-sync **package root** vs **consumer repo root** (host that runs Actions).
 *
 * - Standalone `jira-github-sync` repo: both are the same directory.
 * - Vendored under `.github/workflows/<folder>/`: consumer root is the repository root.
 *
 * Both roots are derived from this module's location (or the bundled `dist/verify.mjs`), not
 * from `process.cwd()`, so audits read the consumer's `jira-sync.yml` from any directory.
 *
 * @module audit/repoPaths
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function isPackageRoot(dir: string): boolean {
  return existsSync(join(dir, 'settings.ts')) && existsSync(join(dir, 'package.json'));
}

/** Directory containing `settings.ts` and `package.json` for this package. */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (isPackageRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'jira-sync package root not found (expected settings.ts + package.json above dist/ or lib/)'
  );
}

/** Host repository root (where `.github/workflows/jira-sync.yml` lives). */
export function consumerRoot(): string {
  const pkg = packageRoot();
  const workflowsDir = dirname(pkg);
  if (basename(workflowsDir) === 'workflows' && basename(dirname(workflowsDir)) === '.github') {
    return dirname(dirname(workflowsDir));
  }
  return pkg;
}

/** Package directory relative to the consumer root, with `/` separators (`''` when standalone). */
export function packagePathFromConsumer(): string {
  return relative(consumerRoot(), packageRoot()).split(sep).join('/');
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
