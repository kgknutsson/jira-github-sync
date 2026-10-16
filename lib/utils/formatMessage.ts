/**
 * Expands `{placeholder}` tokens in Jira comment templates from `settings.ts`.
 *
 * @module utils/formatMessage
 */

/** Replaces `{key}` with `vars[key]`; unknown keys are left as `{key}`. */
export function formatMessage(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}
