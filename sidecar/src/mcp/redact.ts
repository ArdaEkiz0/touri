type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null

export const redactMcpValue = (value: unknown, redact: (text: string) => string): unknown => {
  if (typeof value === "string") return redact(value)
  if (Array.isArray(value)) return value.map((item) => redactMcpValue(item, redact))
  if (!isObject(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactMcpValue(item, redact)]))
}
