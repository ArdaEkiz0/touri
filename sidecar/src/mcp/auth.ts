import type { Database } from "bun:sqlite"
import { createHash, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AbsolutePath, Bot, Id, Kernel, Provider, ToolContext } from "@touri/contracts"
import { isRunMcpTokenActive } from "./run-token"

type JsonObject = Record<string, unknown>

export type McpCallerContext = Omit<ToolContext, "signal" | "runId"> & {
  provider: Provider
  browserEnabled: boolean
  computerUse: boolean
}

type ThreadRow = {
  machine: string
  thread_id: Id
  bot_id: Id
  cwd_override: AbsolutePath | null
  provider: Provider
  bot_cwd: AbsolutePath | null
  home_dir: AbsolutePath
  project_id: Id | null
  project_path: AbsolutePath | null
  browser_enabled: number
  computer_use: number
}

type AuthFailure = { success: false; errorCode: "INVALID_AUTH"; error: "Invalid MCP authentication" }
type AuthSuccess = { success: true; caller: McpCallerContext; tokenPath: string }
export type AuthResult = AuthSuccess | AuthFailure

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null

const tokenEqual = (left: string, right: string): boolean => {
  const leftDigest = createHash("sha256").update(left).digest()
  const rightDigest = createHash("sha256").update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export const safeThreadId = (threadId: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(threadId)

const readAuth = (line: string): { thread: string; token: string; tokenId?: string } | null => {
  try {
    const parsed: unknown = JSON.parse(line)
    if (!isObject(parsed) || !isObject(parsed.touriAuth)) return null
    const thread = parsed.touriAuth.thread
    const token = parsed.touriAuth.token
    const tokenId = parsed.touriAuth.tokenId
    if (typeof thread !== "string" || typeof token !== "string" || !safeThreadId(thread)) return null
    if (tokenId !== undefined && (typeof tokenId !== "string" || !/^[a-f0-9]{32}$/.test(tokenId))) return null
    return { thread, token, ...(typeof tokenId === "string" ? { tokenId } : {}) }
  } catch {
    return null
  }
}

const toProvider = (value: string): Provider | null =>
  value === "codex" || value === "claude" || value === "opencode" ? value : null

const toBotFlags = ({
  browserEnabled,
  computerUse,
}: {
  browserEnabled: number
  computerUse: number
}): Pick<Bot, "browserEnabled" | "computerUse"> => ({
  browserEnabled: browserEnabled !== 0,
  computerUse: computerUse !== 0,
})

export const authenticateMcp = ({
  line,
  tokenDir,
  database,
  kernel,
}: {
  line: string
  tokenDir: string
  database: Database
  kernel: Kernel
}): AuthResult => {
  const auth = readAuth(line)
  if (!auth) return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }

  let expectedToken: string
  const tokenPath = join(tokenDir, auth.tokenId ? `${auth.thread}.${auth.tokenId}` : auth.thread)
  if (auth.tokenId && !isRunMcpTokenActive(kernel, tokenPath))
    return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }
  try {
    expectedToken = readFileSync(tokenPath, "utf8").trim()
  } catch {
    return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }
  }
  if (!tokenEqual(auth.token, expectedToken))
    return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }

  const row = database
    .query(
      `SELECT t.id AS thread_id, t.bot_id, t.cwd_override, b.provider, b.cwd AS bot_cwd,
              b.machine, b.home_dir, b.project_id, p.path AS project_path, b.browser_enabled, b.computer_use
         FROM threads t
         JOIN bots b ON b.id = t.bot_id
         LEFT JOIN projects p ON p.id = b.project_id
        WHERE t.id = ?`,
    )
    .get(auth.thread) as ThreadRow | null
  if (!row) return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }
  // A VM must never fall back to a shared per-thread credential.
  if (row.machine === "vm" && !auth.tokenId)
    return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }
  const provider = toProvider(row.provider)
  if (!provider) return { success: false, errorCode: "INVALID_AUTH", error: "Invalid MCP authentication" }

  const flags = toBotFlags({ browserEnabled: row.browser_enabled, computerUse: row.computer_use })
  return {
    success: true,
    tokenPath,
    caller: {
      botId: row.bot_id,
      threadId: row.thread_id,
      projectId: row.project_id,
      cwd: row.machine === "vm" ? "/workspace" : (row.cwd_override ?? row.bot_cwd ?? row.project_path ?? row.home_dir),
      provider,
      ...flags,
    },
  }
}
