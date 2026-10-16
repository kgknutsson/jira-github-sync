import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CONDITIONS, EVENT_NAMES, PLACEHOLDERS } from '../lib/config/catalog';
import { DEFAULT_SYNC_OPTIONS } from '../lib/config/syncOptions';

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return entry.endsWith('.md') ? [path] : [];
  });
}

describe('docs', () => {
  it('the rules reference covers every event, condition, placeholder and option', () => {
    const reference = readFileSync('docs/configuration.md', 'utf8');
    const terms = [
      ...EVENT_NAMES.map((event) => `\`${event}\``),
      ...Object.keys(CONDITIONS).map((condition) => `\`${condition}\``),
      ...Object.keys(PLACEHOLDERS).map((placeholder) => `{${placeholder}}`),
      ...Object.keys(DEFAULT_SYNC_OPTIONS).map((option) => `\`${option}\``),
    ];
    expect(terms.filter((term) => !reference.includes(term))).toEqual([]);
  });

  it('relative links in markdown files point at existing files', () => {
    const broken = markdownFiles('.').flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1]!)
        .filter((target) => !/^(https?:|mailto:|#)/.test(target))
        .filter((target) => !existsSync(resolve(dirname(file), target.split('#')[0]!)))
        .map((target) => `${file} → ${target}`)
    );
    expect(broken).toEqual([]);
  });

  it('validate commands run the current release', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const tags = markdownFiles('.')
      .filter((file) => !file.endsWith('CHANGELOG.md'))
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(/jira-github-sync\/archive\/refs\/tags\/(.+?)\.tar\.gz/g)].map(
          (match) => `${file}: ${match[1]}`
        )
      );
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.filter((tag) => !tag.endsWith(`: v${version}`))).toEqual([]);
  });
});
