/**
 * Compares two dotted version strings (e.g. GitHub release tags against
 * `__APP_VERSION__`), ignoring a leading "v" and any build/prerelease
 * suffix (`+meta`, `-rc.1`). Missing trailing segments count as 0, so
 * "3.1" and "3.1.0" compare equal. This intentionally does not implement
 * full semver precedence (e.g. prerelease ordering) -- callers that care
 * about prereleases, such as the update checker, are expected to filter
 * those out before comparing.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const toParts = (version: string) =>
    version
      .replace(/^v/i, '')
      .split(/[+-]/, 1)[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)

  const candidateParts = toParts(candidate)
  const currentParts = toParts(current)
  const total = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < total; index += 1) {
    const difference = (candidateParts[index] ?? 0) - (currentParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}
