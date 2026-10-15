/** Defense in depth for tool parameters/results, before storage and again before display. */
export const redactToolText = (text: string, redactKnown: (value: string) => string = (value) => value): string => {
  const scrub = (value: string): string =>
    value
      .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "[REDACTED]")
      .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, "[REDACTED]")
      .replace(
        /(--(?:[\w-]*(?:token|password|secret|api[_-]?key|credential)[\w-]*)\s+)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1[REDACTED]",
      )
      .replace(/\bBearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(
        /((?:[\w-]*(?:token|password|secret|api[_-]?key|credential)[\w-]*|authorization)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "$1[REDACTED]",
      )
      .replace(/\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s/:@]{1,128}:[^\s/@]{1,256}@[^\s]{0,2048}/gi, "[REDACTED]")
  const visit = (value: unknown, key = ""): unknown => {
    if (/token|password|secret|api[_-]?key|credential|authorization/i.test(key)) return "[REDACTED]"
    if (typeof value === "string") return redactKnown(scrub(value))
    if (Array.isArray(value)) return value.map((item) => visit(item))
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)]))
    return value
  }
  try {
    return JSON.stringify(visit(JSON.parse(text)), null, 2)
  } catch {
    return redactKnown(scrub(text))
  }
}
