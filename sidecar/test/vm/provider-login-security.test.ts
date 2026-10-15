import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Kernel } from "@touri/contracts"
import { readProviderLogin } from "../../src/vm/provider-login"

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "touri-provider-source-"))
  mkdirSync(join(root, ".claude"))
  writeFileSync(join(root, ".claude/.credentials.json"), "{}")
  let source = "vault",
    calls = 0
  let vault = async (): Promise<unknown> => ({ success: true, value: { value: null } })
  const kernel = {
    db: { query: () => ({ get: () => ({ value_json: JSON.stringify(source) }) }) },
    callHost: () => {
      calls++
      return vault()
    },
  } as unknown as Kernel
  return {
    root,
    kernel,
    bot: { id: "test", provider: "claude" } as Bot,
    source: (s: string) => {
      source = s
    },
    vault: (fn: typeof vault) => {
      vault = fn
    },
    calls: () => calls,
    stop: () => rmSync(root, { recursive: true, force: true }),
  }
}
for (const kind of ["missing", "locked", "denied", "transport", "timeout"] as const)
  test(`B07 selected vault fails closed on ${kind} with an available host file`, async () => {
    const f = fixture()
    f.vault(async () => {
      if (kind === "timeout") return new Promise(() => {})
      if (kind === "transport") throw new Error("transport")
      return kind === "missing" ? { success: true, value: { value: null } } : { success: false, errorCode: kind }
    })
    try {
      await expect(readProviderLogin(f.kernel, f.bot, f.root, { timeoutMs: 10 })).rejects.toThrow()
      expect(f.calls()).toBe(1)
    } finally {
      f.stop()
    }
  })
test("B07 explicit host file succeeds independently of a locked vault and rejects a replaced symlink", async () => {
  const f = fixture()
  f.source("host-file")
  f.vault(async () => {
    throw new Error("vault must not be consulted")
  })
  try {
    expect((await readProviderLogin(f.kernel, f.bot, f.root)).source).toBe("file")
    expect(f.calls()).toBe(0)
    rmSync(join(f.root, ".claude/.credentials.json"))
    writeFileSync(join(f.root, "outside"), "{}")
    symlinkSync(join(f.root, "outside"), join(f.root, ".claude/.credentials.json"))
    await expect(readProviderLogin(f.kernel, f.bot, f.root)).rejects.toThrow()
  } finally {
    f.stop()
  }
})
test("B07 changing the selected source while vault access is pending aborts release", async () => {
  const f = fixture()
  let reply: (value: unknown) => void = () => {}
  f.vault(
    () =>
      new Promise((resolve) => {
        reply = resolve
      }),
  )
  try {
    const operation = readProviderLogin(f.kernel, f.bot, f.root)
    await Bun.sleep(0)
    f.source("host-file")
    reply({ success: true, value: { value: "synthetic-test-value" } })
    await expect(operation).rejects.toThrow("fonte de login mudou")
  } finally {
    f.stop()
  }
})

test("B07 OpenCode follows the same explicit selection: vault fails closed, host file only when selected", async () => {
  const f = fixture()
  const bot = { id: "test", provider: "opencode" } as Bot
  mkdirSync(join(f.root, ".local/share/opencode"), { recursive: true })
  writeFileSync(join(f.root, ".local/share/opencode/auth.json"), "{}")
  try {
    await expect(readProviderLogin(f.kernel, bot, f.root, { timeoutMs: 10 })).rejects.toThrow("OpenCode")
    expect(f.calls()).toBe(1)
    f.source("host-file")
    expect((await readProviderLogin(f.kernel, bot, f.root)).source).toBe("file")
    expect(f.calls()).toBe(1)
  } finally {
    f.stop()
  }
})
