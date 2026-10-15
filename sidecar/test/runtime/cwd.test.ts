import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Kernel, Thread } from "@touri/contracts"
import { workingDirectory } from "../../src/runtime/session"

const kernel = {} as Kernel

test("a missing bot cwd is created instead of failing the spawn", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-cwd-"))
  try {
    const cwd = join(root, "workspaces/onb")
    const result = await workingDirectory({
      kernel,
      bot: { cwd, homeDir: join(root, "home"), projectId: null } as Bot,
      thread: { cwdOverride: null } as Thread,
    })
    expect(result.cwd).toBe(cwd)
    expect(existsSync(cwd)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an uncreatable cwd falls back to the bot home", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-cwd-"))
  try {
    const result = await workingDirectory({
      kernel,
      bot: { cwd: "/dev/null/nope", homeDir: join(root, "home"), projectId: null } as Bot,
      thread: { cwdOverride: null } as Thread,
    })
    expect(result.cwd).toBe(join(root, "home"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
