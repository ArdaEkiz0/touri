export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null

const hasOwn = (value: JsonObject, key: string): boolean => Object.hasOwn(value, key)

export const parseJsonRpcRequest = (line: string): JsonRpcRequest | null => {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isObject(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") return null
    if (hasOwn(parsed, "id") && parsed.id !== null && typeof parsed.id !== "string" && typeof parsed.id !== "number")
      return null
    const request: JsonRpcRequest = { jsonrpc: "2.0", method: parsed.method }
    if (hasOwn(parsed, "id")) request.id = parsed.id as JsonRpcId
    if (hasOwn(parsed, "params")) request.params = parsed.params
    return request
  } catch {
    return null
  }
}

export const isJsonRpcRequest = (request: JsonRpcRequest): boolean => request.id !== undefined
