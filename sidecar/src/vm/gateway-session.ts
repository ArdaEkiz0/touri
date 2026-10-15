import { timingSafeEqual } from "node:crypto"

export const GATEWAY_SESSION_PATH = "/__touri/session"
const COOKIE_PREFIX = "touri_cap_"
const SAFE_NEXT = /^\/(?![/\\])[\x21-\x7e]*$/
const SAME_ORIGIN_SITES = [null, "same-origin", "none"]

export type GatewayRequestArgs = {
  target: string
  capability: string
  port: number
  cookie: string | null
  fetchSite: string | null
}

export type GatewayDecision =
  | { action: "forward"; route: string }
  | { action: "session"; location: string; setCookie: string }
  | { action: "deny" }

export const gatewayCookieName = (port: number): string => `${COOKIE_PREFIX}${port}`

const sameSecret = (left: string, right: string): boolean =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right))

const cookieValue = ({ cookie, name }: { cookie: string | null; name: string }): string | null =>
  (cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1))
    .at(0) ?? null

/** Removes Touri capability cookies so a guest application never receives the gateway secret. */
export const withoutCapabilityCookies = (cookie: string): string =>
  cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(COOKIE_PREFIX))
    .join("; ")

const sessionDecision = ({
  query,
  capability,
  port,
}: {
  query: string
  capability: string
  port: number
}): GatewayDecision => {
  const next = new URLSearchParams(query).get("next") ?? "/"
  if (!SAFE_NEXT.test(next)) return { action: "deny" }
  return {
    action: "session",
    location: next,
    setCookie: `${gatewayCookieName(port)}=${capability}; Path=/; HttpOnly; SameSite=Strict`,
  }
}

const prefixRoute = ({ path, query, prefix }: { path: string; query: string; prefix: string }): string | null => {
  if (path === prefix) return `/${query}`
  if (path.startsWith(`${prefix}/`)) return `${path.slice(prefix.length)}${query}`
  return null
}

/**
 * Decides how a loopback gateway treats one request. A capability in the path always works;
 * a browser that bootstrapped through the session path may then load root-relative assets,
 * links and WebSockets with an HttpOnly same-site cookie scoped to this gateway's port.
 */
export const authorizeGatewayRequest = ({
  target,
  capability,
  port,
  cookie,
  fetchSite,
}: GatewayRequestArgs): GatewayDecision => {
  const prefix = `/touri/${capability}`
  const split = target.indexOf("?")
  const path = split < 0 ? target : target.slice(0, split)
  const query = split < 0 ? "" : target.slice(split)
  if (path === `${prefix}${GATEWAY_SESSION_PATH}`) return sessionDecision({ query, capability, port })
  const route = prefixRoute({ path, query, prefix })
  if (route !== null) return { action: "forward", route }
  const presented = cookieValue({ cookie, name: gatewayCookieName(port) })
  if (presented === null || !sameSecret(presented, capability) || !SAME_ORIGIN_SITES.includes(fetchSite))
    return { action: "deny" }
  return { action: "forward", route: target }
}
