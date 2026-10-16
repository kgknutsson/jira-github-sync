import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const GENERATED = 'dist jira-sync.config.schema.json';

describe('jira-sync bundled runner', () => {
  it('committed dist/ and schema match sources (node build.mjs produces no git diff)', () => {
    execSync('node build.mjs', { cwd: REPO_ROOT, stdio: 'pipe' });
    const diff = execSync(`git diff -- ${GENERATED}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(diff, 'Rebuild and commit: node build.mjs').toBe('');
  });
});
