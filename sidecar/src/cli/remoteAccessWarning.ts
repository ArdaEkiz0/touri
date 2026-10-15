export type RemoteAccessWarningArgs = { host: string; proxied: boolean }

const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "::1", "localhost"]

/**
 * Startup notice for operators who bind the server beyond loopback without an HTTPS
 * proxy: such clients are refused with HTTP 426 since the transport hardening.
 */
export const remoteAccessWarning = ({ host, proxied }: RemoteAccessWarningArgs): string | null => {
  if (proxied || LOOPBACK_HOSTS.includes(host)) return null

  return `aviso: ${host} é acessível pela rede, mas dispositivos remotos recebem HTTP 426 sem HTTPS. Use --host 127.0.0.1 com --tailscale ou --trust-proxy.`
}
