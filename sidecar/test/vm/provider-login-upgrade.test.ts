import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Kernel } from "@touri/contracts"
import {
  ProviderLoginError,
  providerLoginSourceKey,
  readProviderLogin,
  storedProviderLoginSource,
  VAULT_READ_DEADLINE_MS,
} from "../../src/vm/provider-login"

type Vault = () => Promise<unknown>

const fixture = (vault: Vault, withHostFile: boolean) => {
  const root = mkdtempSync(join(tmpdir(), "touri-login-upgrade-"))
  if (withHostFile) {
    mkdirSync(join(root, ".codex"))
    writeFileSync(join(root, ".codex/auth.json"), '{"tokens":{}}')
  }
  const db = new Database(":memory:")
  db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)")
  const calls: Array<string> = []
  const kernel = {
    db,
    callHost: (method: string) => {
      calls.push(method)
      return vault()
    },
  } as unknown as Kernel
  const bot = { id: "upgraded", provider: "codex" } as Bot
  return { root, kernel, bot, db, calls, stop: () => rmSync(root, { recursive: true, force: true }) }
}

test("upgrade: bot with no recorded source and no vault entry resolves once to the host login file", async () => {
  const f = fixture(async () => ({ success: true, value: { value: null } }), true)
  try {
    expect((await readProviderLogin(f.kernel, f.bot, f.root)).selection).toBe("host-file")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBe("host-file")
    expect((await readProviderLogin(f.kernel, f.bot, f.root)).source).toBe("file")
    expect(f.calls).toEqual(["keychain.get"])
  } finally {
    f.stop()
  }
})

test("upgrade: an existing vault entry keeps the vault even when the host file also exists", async () => {
  const f = fixture(async () => ({ success: true, value: { value: '{"tokens":{}}' } }), true)
  try {
    expect((await readProviderLogin(f.kernel, f.bot, f.root)).selection).toBe("vault")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBe("vault")
  } finally {
    f.stop()
  }
})

test("new bot with neither login resolves to the vault and guides instead of reporting a timeout", async () => {
  const f = fixture(async () => ({ success: true, value: { value: null } }), false)
  try {
    const error = await readProviderLogin(f.kernel, f.bot, f.root).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProviderLoginError)
    expect((error as ProviderLoginError).reason).toBe("not-found")
    expect((error as ProviderLoginError).message).not.toContain("não respondeu")
    expect((error as ProviderLoginError).message).toContain("codex login --device-auth")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBe("vault")
  } finally {
    f.stop()
  }
})

test("a vault that does not answer is a transport failure and persists no source decision", async () => {
  const f = fixture(() => new Promise(() => {}), true)
  try {
    const error = await readProviderLogin(f.kernel, f.bot, f.root, { timeoutMs: 10 }).catch((caught: unknown) => caught)
    expect((error as ProviderLoginError).reason).toBe("transport")
    expect((error as ProviderLoginError).message).toContain("não respondeu")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBeNull()
    expect(f.db.query("SELECT value_json FROM settings WHERE key = ?").get(providerLoginSourceKey(f.bot))).toBeNull()
  } finally {
    f.stop()
  }
})

test("a denied vault is a transport failure, never a not-found", async () => {
  const f = fixture(async () => ({ success: false, errorCode: "HOST_ERROR", error: "denied" }), true)
  try {
    const error = await readProviderLogin(f.kernel, f.bot, f.root).catch((caught: unknown) => caught)
    expect((error as ProviderLoginError).reason).toBe("transport")
  } finally {
    f.stop()
  }
})

test("the vault read deadline returns a useful failure within five seconds", () => {
  expect(VAULT_READ_DEADLINE_MS).toBeLessThanOrEqual(5000)
  expect(VAULT_READ_DEADLINE_MS).toBeGreaterThan(0)
})

test("an explicit source is never re-decided at run time", async () => {
  const f = fixture(async () => ({ success: true, value: { value: null } }), true)
  f.db.run("INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)", [
    providerLoginSourceKey(f.bot),
    '"vault"',
    1,
  ])
  try {
    await expect(readProviderLogin(f.kernel, f.bot, f.root)).rejects.toThrow("ainda não está conectado")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBe("vault")
  } finally {
    f.stop()
  }
})

test("doctor reports the per-bot login source and health without persisting a decision", async () => {
  const { providerLoginChecks } = await import("../../src/doctor/providerLogin")
  const f = fixture(async () => ({ success: true, value: { value: null } }), true)
  f.db.run(
    "CREATE TABLE bots (id TEXT, name TEXT, provider TEXT, machine TEXT, vm_provider_login INTEGER, archived_at INTEGER)",
  )
  f.db.run("INSERT INTO bots VALUES ('upgraded','Ana','codex','vm',1,NULL)")
  try {
    const pending = await providerLoginChecks(f.kernel, f.root, new AbortController().signal)
    expect(pending[0]?.status).toBe("warn")
    expect(pending[0]?.detail).toContain("fonte do login")
    expect(storedProviderLoginSource(f.kernel, f.bot)).toBeNull()
    f.db.run("INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,1)", [
      providerLoginSourceKey(f.bot),
      '"host-file"',
    ])
    const ok = await providerLoginChecks(f.kernel, f.root, new AbortController().signal)
    expect(ok[0]?.status).toBe("pass")
    expect(ok[0]?.label).toContain("arquivo do host")
  } finally {
    f.stop()
  }
})
