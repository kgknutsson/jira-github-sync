/**
 * Expands `{placeholder}` tokens in comment templates from the rules file.
 *
 * @module utils/formatMessage
 */

/** Replaces `{key}` with `vars[key]`; unknown keys are left as `{key}`. */
export function formatMessage(template: string, vars: Record<string, string>): string {
  return template.replace(
    /\{(\w+)\}/g,
    (_, key: string) => (Object.hasOwn(vars, key) ? vars[key] : undefined) ?? `{${key}}`
  );
}
