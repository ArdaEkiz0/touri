import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { join } from "node:path"
import type { Kernel } from "@touri/contracts"
import { atomicWriteFile, ensurePrivateDirectory, readPrivateFile, removePrivateFile } from "../kernel/files"

export type SavedCookie = Record<string, unknown>
export type SavedSession = {
  cookies: Array<SavedCookie>
  storage: Record<string, Record<string, string>>
}

type Envelope =
  | { v: 1; enc: "aes-256-gcm"; iv: string; tag: string; data: string }
  | { v: 1; enc: "none"; data: string }

const MAX_SESSION_BYTES = 2 * 1024 * 1024
const KEY_BYTES = 32
const IV_BYTES = 12
const SAFE_BOT_ID = /^[A-Za-z0-9_-]+$/

export const emptySession = (): SavedSession => ({ cookies: [], storage: {} })

const keyAccount = (botId: string): string => `browser-session-key:${botId}`

const sessionsDir = (kernel: Kernel): string => join(kernel.paths.browserDir, "sessions")

const sessionPath = (kernel: Kernel, botId: string): string => join(sessionsDir(kernel), `${botId}.json`)

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toSession = (value: unknown): SavedSession | null => {
  if (!isRecord(value) || !Array.isArray(value.cookies)) return null
  const storage = isRecord(value.storage) ? (value.storage as SavedSession["storage"]) : {}
  return { cookies: value.cookies.filter(isRecord), storage }
}

const readKey = async (kernel: Kernel, botId: string): Promise<Buffer | null> => {
  const result = await kernel.callHost("keychain.get", { account: keyAccount(botId) }).catch(() => null)
  if (!result?.success || typeof result.value.value !== "string") return null
  const key = Buffer.from(result.value.value, "base64")
  return key.byteLength === KEY_BYTES ? key : null
}

const ensureKey = async (kernel: Kernel, botId: string): Promise<Buffer | null> => {
  const existing = await readKey(kernel, botId)
  if (existing) return existing
  const created = randomBytes(KEY_BYTES)
  const stored = await kernel
    .callHost("keychain.set", { account: keyAccount(botId), value: created.toString("base64") })
    .catch(() => null)
  if (!stored?.success) return null
  return (await readKey(kernel, botId)) ? created : null
}

const seal = (plain: string, key: Buffer | null): Envelope => {
  if (!key) return { v: 1, enc: "none", data: Buffer.from(plain).toString("base64") }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return {
    v: 1,
    enc: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  }
}

const open = (envelope: Envelope, key: Buffer | null): string | null => {
  if (envelope.enc === "none") return Buffer.from(envelope.data, "base64").toString("utf8")
  if (!key) return null
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"))
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

const toEnvelope = (value: unknown): Envelope | null => {
  if (!isRecord(value) || value.v !== 1 || typeof value.data !== "string") return null
  if (value.enc === "none") return { v: 1, enc: "none", data: value.data }
  if (value.enc !== "aes-256-gcm" || typeof value.iv !== "string" || typeof value.tag !== "string") return null
  return { v: 1, enc: "aes-256-gcm", iv: value.iv, tag: value.tag, data: value.data }
}

/**
 * Bot-private browser session file (cookies and per-origin localStorage). The file is mode 0600 inside a 0700
 * directory and is encrypted with AES-256-GCM using a per-bot key kept in the host keychain. When the keychain is
 * unavailable it falls back to the file mode alone. The content is never logged or reported.
 */
export const hasBotSession = (kernel: Kernel, botId: string): boolean =>
  SAFE_BOT_ID.test(botId) &&
  readPrivateFile({ root: kernel.paths.appData, path: sessionPath(kernel, botId), maxBytes: 1 }) !== null

export const loadBotSession = async (kernel: Kernel, botId: string): Promise<SavedSession> => {
  if (!SAFE_BOT_ID.test(botId)) return emptySession()
  const raw = readPrivateFile({
    root: kernel.paths.appData,
    path: sessionPath(kernel, botId),
    maxBytes: MAX_SESSION_BYTES * 2,
  })
  if (!raw) return emptySession()
  const envelope = toEnvelope(parseJson(raw.toString("utf8")))
  if (!envelope) return emptySession()
  const plain = open(envelope, envelope.enc === "none" ? null : await readKey(kernel, botId))
  return toSession(plain === null ? null : parseJson(plain)) ?? emptySession()
}

export const saveBotSession = async ({
  kernel,
  botId,
  session,
}: {
  kernel: Kernel
  botId: string
  session: SavedSession
}): Promise<boolean> => {
  if (!SAFE_BOT_ID.test(botId)) return false
  const plain = JSON.stringify(session)
  if (plain.length > MAX_SESSION_BYTES) return false
  const key = await ensureKey(kernel, botId)
  ensurePrivateDirectory({ root: kernel.paths.appData, path: sessionsDir(kernel) })
  atomicWriteFile({
    root: kernel.paths.appData,
    path: sessionPath(kernel, botId),
    content: JSON.stringify(seal(plain, key)),
    mode: 0o600,
  })
  return true
}

export const removeBotSession = async (kernel: Kernel, botId: string): Promise<void> => {
  if (!SAFE_BOT_ID.test(botId)) return
  removePrivateFile({ root: kernel.paths.appData, path: sessionPath(kernel, botId) })
  const result = await kernel.callHost("keychain.delete", { account: keyAccount(botId) })
  if (!result.success) throw new Error("Não foi possível apagar a chave da sessão do navegador do bot.")
}

export const botSessionPath = sessionPath
