/**
 * Chooses a Jira workflow transition that lands in the target status column.
 *
 * @module utils/pickTransition
 */

/** One available transition from Jira's transitions API. */
export type JiraTransitionOption = {
  id: string;
  name: string;
  to: { name: string };
};

/** Prefers named transitions, then any transition whose `to.name` matches target. */
export function pickTransition(
  transitions: JiraTransitionOption[],
  targetStatus: string,
  preferredTransitionNames: readonly string[] = []
): JiraTransitionOption | null {
  for (const pref of preferredTransitionNames) {
    const byName = transitions.find((t) => t.name === pref && t.to.name === targetStatus);
    if (byName) return byName;
  }

  return transitions.find((t) => t.to.name === targetStatus) ?? null;
}
