const NETWORK_ERRORS: Array<{ code: string; cause: string }> = [
  { code: "ERR_NAME_NOT_RESOLVED", cause: "o endereço não existe ou o DNS não respondeu" },
  { code: "ERR_CONNECTION_REFUSED", cause: "o servidor recusou a conexão" },
  { code: "ERR_CONNECTION_TIMED_OUT", cause: "o servidor não respondeu a tempo (rede bloqueada ou fora do ar)" },
  { code: "ERR_TIMED_OUT", cause: "o servidor não respondeu a tempo" },
  { code: "ERR_CONNECTION_RESET", cause: "a conexão foi interrompida pelo servidor" },
  { code: "ERR_CONNECTION_CLOSED", cause: "a conexão foi encerrada pelo servidor" },
  { code: "ERR_ADDRESS_UNREACHABLE", cause: "o endereço não é alcançável a partir desta máquina" },
  { code: "ERR_NETWORK_ACCESS_DENIED", cause: "o acesso à rede foi negado pela política da máquina" },
  { code: "ERR_INTERNET_DISCONNECTED", cause: "a máquina está sem internet" },
  { code: "ERR_NETWORK_CHANGED", cause: "a rede mudou durante o carregamento" },
  { code: "ERR_BLOCKED_BY_CLIENT", cause: "o endereço foi bloqueado pela política do navegador" },
  { code: "ERR_CERT_AUTHORITY_INVALID", cause: "o certificado do site não é confiável" },
  { code: "ERR_CERT_DATE_INVALID", cause: "o certificado do site expirou ou ainda não é válido" },
  { code: "ERR_SSL_PROTOCOL_ERROR", cause: "falha na conexão segura (SSL)" },
  { code: "ERR_TOO_MANY_REDIRECTS", cause: "o site redireciona em loop" },
  { code: "ERR_INVALID_URL", cause: "o endereço é inválido" },
  { code: "ERR_UNSAFE_PORT", cause: "a porta do endereço é bloqueada pelo navegador" },
]

const ERROR_CODE_PATTERN = /ERR_[A-Z0-9_]+/

/** Extracts a Chrome network error code (ERR_*) from an errorText or an error page body. */
export const networkErrorCode = (text: string): string | null => ERROR_CODE_PATTERN.exec(text)?.[0] ?? null

/** pt-BR sentence for a failed navigation; never includes page content. */
export const describeNavigationFailure = ({ code, url }: { code: string | null; url: string }): string => {
  const known = NETWORK_ERRORS.find((item) => item.code === code)
  const reason = known?.cause ?? (code === null ? "o Chrome não carregou a página" : `erro de rede ${code}`)
  return `Não foi possível abrir ${url}: ${reason}${known && code ? ` (${code})` : ""}.`
}

export const isChromeErrorPage = (href: string): boolean => href.startsWith("chrome-error://")

export const isLoadableUrl = (url: string): boolean => /^https?:/i.test(url)

export const stripHash = (url: string): string => {
  const index = url.indexOf("#")
  return index < 0 ? url : url.slice(0, index)
}
