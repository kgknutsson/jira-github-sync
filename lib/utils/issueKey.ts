/**
 * Extracts `PROJECT-123` issue keys from PR title, body, branch, and commit text.
 *
 * Order: title → body → commit message → branch (see {@link createIssueKeyExtractor}).
 *
 * @module utils/issueKey
 */

/** Factory for ordered issue-key extraction using a project-specific regex. */
export function createIssueKeyExtractor(projectKey: string, pattern: RegExp) {
  const normalize = (raw: string) => normalizeIssueKey(raw, projectKey);

  return {
    extract(parts: {
      title?: string | null;
      branch?: string | null;
      body?: string | null;
      commitMessage?: string | null;
    }): string | null {
      const keys = this.extractAll(parts);
      return keys[0] ?? null;
    },

    extractAll(parts: {
      title?: string | null;
      branch?: string | null;
      body?: string | null;
      commitMessage?: string | null;
    }): string[] {
      const ordered = [parts.title, parts.body, parts.commitMessage, parts.branch];
      const seen = new Set<string>();
      const keys: string[] = [];
      for (const text of ordered) {
        if (!text) continue;
        const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
        const re = new RegExp(pattern.source, flags);
        for (const match of text.matchAll(re)) {
          const key = normalize(match[0]);
          if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
          }
        }
      }
      return keys;
    },
  };
}

/** Uppercases and normalizes a matched key to `PROJECT-123` form. */
export function normalizeIssueKey(raw: string, projectKey: string): string {
  const upper = raw.toUpperCase();
  if (!upper.startsWith(`${projectKey}-`)) {
    return upper;
  }
  return upper;
}

/** Case-insensitive check for {@link SyncOptions.skipMarker}. */
export function textContainsSkipMarker(text: string, marker: string | null): boolean {
  if (!marker) return false;
  return text.toLowerCase().includes(marker.toLowerCase());
}
