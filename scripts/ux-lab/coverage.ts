// Which pages of the app no scenario ever asks anyone to visit.
//
// A page nobody has a reason to open is a page whose problems nobody will report, so this
// is checked rather than assumed.

/**
 * Reached while doing something else rather than as a destination: the catch-all redirect,
 * the phone's overflow menu, and the settings page's own sub-routes.
 */
const NOT_DESTINATIONS = ['*', '/more', '/settings/:section']

export function missingRoutes(
  appRoutes: readonly string[],
  scenarioRoutes: readonly (readonly string[])[],
): string[] {
  const covered = new Set(scenarioRoutes.flat())
  return appRoutes.filter((r) => !NOT_DESTINATIONS.includes(r) && !covered.has(r))
}
