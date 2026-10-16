/**
 * Extracts `PROJECT-123` issue keys from PR title, body, branch, and commit text.
 *
 * Order: title → body → commit message → branch (see {@link createIssueKeyExtractor}).
 *
 * @module utils/issueKey
 */

type IssueKeyParts = {
  title?: string | null;
  branch?: string | null;
  body?: string | null;
  commitMessage?: string | null;
};

/** Factory for ordered issue-key extraction using a project-specific regex. */
export function createIssueKeyExtractor(pattern: RegExp) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;

  const extractAll = (parts: IssueKeyParts): string[] => {
    const ordered = [parts.title, parts.body, parts.commitMessage, parts.branch];
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const text of ordered) {
      if (!text) continue;
      for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
        const key = normalizeIssueKey(match[0]);
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return keys;
  };

  return {
    extract: (parts: IssueKeyParts): string | null => extractAll(parts)[0] ?? null,
    extractAll,
  };
}

/** Uppercases a matched key to Jira's `PROJECT-123` form. */
export function normalizeIssueKey(raw: string): string {
  return raw.toUpperCase();
}

/** Case-insensitive check for {@link SyncOptions.skipMarker}. */
export function textContainsSkipMarker(text: string, marker: string | null): boolean {
  if (!marker) return false;
  return text.toLowerCase().includes(marker.toLowerCase());
}
