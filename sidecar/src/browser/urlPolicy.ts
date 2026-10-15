export const BROWSER_URL_NOT_ALLOWED_MESSAGE =
  "Este endereço não é permitido para o navegador do bot: apenas http e https."

const WEB_PROTOCOLS: ReadonlyArray<string> = ["http:", "https:"]
const ERROR_PAGE_PREFIX = "chrome-error://"

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Normalized http(s) URL for a navigation request, or about:blank; null for every other scheme. */
export const normalizeBrowserUrl = (url: string): string | null => {
  if (url === "about:blank") return url
  const parsed = parse(url)
  if (!parsed || !WEB_PROTOCOLS.includes(parsed.protocol)) return null
  return parsed.href
}

/** Whether a top-level page or a new target may be at this URL. */
export const isAllowedBrowserUrl = (url: string): boolean => normalizeBrowserUrl(url) !== null

/** Whether a page already displayed in a tab may be read (browser error pages are not navigation targets). */
export const isReadableTabUrl = (url: string): boolean =>
  url === "" || isAllowedBrowserUrl(url) || url.startsWith(ERROR_PAGE_PREFIX)
