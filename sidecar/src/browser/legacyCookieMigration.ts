import type { SavedCookie } from "./sessionVault"

export type AssignLegacyCookiesArgs = {
  cookies: Array<SavedCookie>
  ownedHosts: Record<string, Array<string>>
}

const hostMatchesDomain = (host: string, domain: string): boolean => {
  const bare = domain.startsWith(".") ? domain.slice(1) : domain
  return bare !== "" && (host === bare || host.endsWith(`.${bare}`))
}

const owners = ({
  domain,
  ownedHosts,
}: {
  domain: string
  ownedHosts: AssignLegacyCookiesArgs["ownedHosts"]
}): Array<string> =>
  Object.entries(ownedHosts)
    .filter(([, hosts]) => hosts.some((host) => hostMatchesDomain(host, domain)))
    .map(([botId]) => botId)

/**
 * Splits cookies of the old shared profile between bots. A cookie goes to a bot only when that bot, and no other,
 * owned a tab on a matching host; ambiguous and unowned cookies are dropped.
 */
export const assignLegacyCookies = ({
  cookies,
  ownedHosts,
}: AssignLegacyCookiesArgs): Record<string, Array<SavedCookie>> => {
  const assigned = new Map<string, Array<SavedCookie>>()
  for (const cookie of cookies) {
    const domain = typeof cookie.domain === "string" ? cookie.domain : ""
    const matching = owners({ domain, ownedHosts })
    const only = matching.length === 1 ? matching[0] : undefined
    if (only !== undefined) assigned.set(only, [...(assigned.get(only) ?? []), cookie])
  }
  return Object.fromEntries(assigned)
}
