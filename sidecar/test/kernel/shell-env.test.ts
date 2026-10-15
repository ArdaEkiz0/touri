import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Kernel } from "@touri/contracts"
import { buildChildEnv, createShellEnv, mergePath, parseEnvOutput } from "../../src/kernel/shell-env"

type Spawn = Kernel["spawnTree"]

const fakeSpawn =
  ({ stdout, calls }: { stdout: string; calls: { count: number } }): Spawn =>
  () => {
    calls.count += 1
    return {
      success: true,
      pid: 1,
      pgid: 1,
      stdout: new Response(stdout).body as ReadableStream<Uint8Array>,
      stderr: new Response("").body as ReadableStream<Uint8Array>,
      stdin: new WritableStream<Uint8Array>(),
      extra: [],
      exited: Promise.resolve({ code: 0, signal: null }),
      kill: () => undefined,
    }
  }

test("parseEnvOutput skips rc noise before the marker", () => {
  const output = "banner\0__M__\0PATH=/a:/b\0FOO=bar=baz\0"
  expect(parseEnvOutput({ output, marker: "__M__" })).toEqual({ PATH: "/a:/b", FOO: "bar=baz" })
})

test("mergePath keeps order, dedupes and adds existing tool directories", () => {
  const known = new Set(["/h/.local/bin", "/h/.bun/bin", "/opt/homebrew/bin"])
  const merged = mergePath({ path: "/usr/x:/opt/homebrew/bin", home: "/h", exists: (path) => known.has(path) })
  expect(merged).toBe("/usr/x:/opt/homebrew/bin:/h/.local/bin:/h/.bun/bin")
})

test("mergePath adds nvm node bins when present", () => {
  const home = mkdtempSync(join(tmpdir(), "touri-nvm-"))
  try {
    mkdirSync(join(home, ".nvm/versions/node/v22.1.0/bin"), { recursive: true })
    expect(mergePath({ path: "/usr/bin", home })).toContain(`${home}/.nvm/versions/node/v22.1.0/bin`)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("shellEnv reads the login shell once, merges PATH and strips TOURI_ secrets", async () => {
  const calls = { count: 0 }
  const stdout = "rc noise\0__TOURI_ENV__\0PATH=/fake/node/bin\0HOME=/nonexistent-home\0TOURI_UI_TOKEN=secret\0"
  const { shellEnv } = createShellEnv({ spawn: fakeSpawn({ stdout, calls }), shell: "/bin/fake" })
  const first = await shellEnv()
  const second = await shellEnv()
  expect(calls.count).toBe(1)
  expect(first.PATH?.startsWith("/fake/node/bin")).toBe(true)
  expect(first.PATH).toContain("/usr/bin")
  expect(first.TOURI_UI_TOKEN).toBeUndefined()
  expect(second).toEqual(first)
})

test("shellEnv falls back to a usable PATH when the shell cannot start", async () => {
  const failing: Spawn = () => ({ success: false, error: "boom", errorCode: "SPAWN_FAILED" })
  const { shellEnv } = createShellEnv({ spawn: failing })
  expect((await shellEnv()).PATH).toContain("/usr/bin")
})

test("shell environments start lazily and disposing kills an in-flight login shell", async () => {
  const calls = { count: 0 }
  let killed = false
  let output: ReadableStreamDefaultController<Uint8Array> | undefined
  const base = fakeSpawn({ stdout: "", calls })
  const spawn: Spawn = () => {
    const child = base({ cmd: "", args: [], cwd: "", env: {} })
    if (!child.success) return child
    return {
      ...child,
      stdout: new ReadableStream<Uint8Array>({
        start: (controller) => {
          output = controller
        },
      }),
      kill: () => {
        killed = true
        output?.close()
      },
    }
  }
  const shell = createShellEnv({ spawn })
  expect(calls.count).toBe(0)
  const pending = shell.shellEnv()
  expect(calls.count).toBe(1)
  shell.dispose()
  expect(killed).toBe(true)
  await pending
  await shell.shellEnv()
  expect(calls.count).toBe(1)
})

test("buildChildEnv strips internal tokens", () => {
  expect(buildChildEnv({ base: { A: "1", TOURI_HOST_TOKEN: "x" } })).toEqual({ A: "1" })
})
