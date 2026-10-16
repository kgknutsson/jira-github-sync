import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const DIST_GLOB = 'dist';

describe('jira-sync bundled runner', () => {
  it('committed dist/ matches sources (node build.mjs produces no git diff)', () => {
    execSync('node build.mjs', { cwd: REPO_ROOT, stdio: 'pipe' });
    const diff = execSync(`git diff -- ${DIST_GLOB}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(diff, 'Rebuild dist and commit: node build.mjs').toBe('');
  });
});
