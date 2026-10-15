const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"])
const proxyHeaders = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "tailscale-user-login"]

const hostName = (host: string): string => {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1)
  return host.split(":")[0] ?? host
}

/**
 * True only for a request that reached the socket directly from the same machine: loopback peer,
 * loopback Host header and no proxy headers. Requests relayed by a local reverse proxy never qualify.
 */
export const isDirectLoopback = ({ clientIp, headers }: { clientIp: string | null; headers: Headers }): boolean => {
  if (clientIp === null || !loopbackAddresses.has(clientIp)) return false
  if (proxyHeaders.some((name) => headers.has(name))) return false
  const host = headers.get("host")
  return host !== null && loopbackHosts.has(hostName(host))
}
