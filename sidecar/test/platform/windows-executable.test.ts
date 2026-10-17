import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveExecutable } from "../../src/runtime/utils"

test.skipIf(process.platform !== "win32")(
  "provider CLIs are found on a Windows PATH, including .exe and npm .cmd shims",
  () => {
    const root = mkdtempSync(join(tmpdir(), "touri-windows-executable-"))
    try {
      const native = join(root, "native")
      const npm = join(root, "npm")
      mkdirSync(native)
      mkdirSync(npm)
      writeFileSync(join(native, "fixture-claude.exe"), "")
      writeFileSync(join(npm, "fixture-opencode.cmd"), "@echo off\r\n")
      const env = { PATH: [join(root, "missing"), native, npm].join(";") }
      expect(resolveExecutable({ command: "fixture-claude", env })).toEqual({
        success: true,
        path: join(native, "fixture-claude.exe"),
      })
      expect(resolveExecutable({ command: "fixture-opencode", env })).toEqual({
        success: true,
        path: join(npm, "fixture-opencode.cmd"),
      })
      expect(resolveExecutable({ command: "fixture-absent", env })).toMatchObject({
        success: false,
        errorCode: "cli_missing",
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
)
