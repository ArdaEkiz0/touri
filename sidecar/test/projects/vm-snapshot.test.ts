import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { VmRuntime } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { copyProjectSnapshot } from "../../src/projects/vm-snapshot"
import type { VmProvider } from "../../src/vm/types"
import { fakeVmProvider } from "../vm/fake-provider"

test("VM snapshot preserves origin and exact commit without touching the source or copying host files", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-project-snapshot-"))
  const source = join(root, "source")
  const guest = join(root, "guest")
  mkdirSync(source)
  mkdirSync(guest)
  const runtime = createKernel({ appData: join(root, "data") })
  const git = (cwd: string, args: string[]) => {
    const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
    return new TextDecoder().decode(result.stdout).trim()
  }
  // Run the guest file/CLI boundary in a temporary directory. No VM service or
  // existing containers participate in this regression.
  const mapArg = (arg: string) => (arg.startsWith("/tmp/touri-project-") ? join(guest, arg.slice(5)) : arg)
  const exec: VmRuntime["exec"] = async ({ command, args = [] }) => {
    const child = Bun.spawn({ cmd: [command, ...args.map(mapArg)], cwd: guest, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return code === 0
      ? { success: true, code, stdout, stderr }
      : { success: false, errorCode: "COMMAND_FAILED", error: stderr }
  }
  const provider: VmProvider = {
    ...fakeVmProvider().provider,
    spawn: (input) =>
      runtime.kernel.spawnTree({
        cmd: input.command,
        args: (input.args ?? []).map(mapArg),
        cwd: guest,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      }),
  }
  try {
    git(source, ["init", "-q"])
    git(source, ["config", "user.email", "test@example.com"])
    git(source, ["config", "user.name", "Test"])
    git(source, ["remote", "add", "origin", "https://user:private-token@example.test/source.git"])
    writeFileSync(join(source, "README.md"), "committed source")
    git(source, ["add", "."])
    git(source, ["commit", "-qm", "fixture"])
    const commit = git(source, ["rev-parse", "HEAD"])
    writeFileSync(join(source, "README.md"), "host edits stay here")
    writeFileSync(join(source, ".env"), "host-secret")
    const configBefore = readFileSync(join(source, ".git/config"), "utf8")
    const snapshot = await copyProjectSnapshot({
      kernel: { ...runtime.kernel, shellEnv: async () => ({ PATH: process.env.PATH ?? "/usr/bin:/bin" }) },
      provider,
      vmId: "throwaway",
      botId: "readonly",
      projectPath: source,
      exec,
      signal: AbortSignal.timeout(10000),
    })
    expect(snapshot.commit).toBe(commit)
    expect(snapshot.remote).toBe("https://example.test/source.git")
    expect(git(guest, ["rev-parse", "HEAD"])).toBe(commit)
    expect(git(guest, ["remote", "get-url", "origin"])).toBe(snapshot.remote ?? "")
    expect(readFileSync(join(guest, "README.md"), "utf8")).toBe("committed source")
    expect(existsSync(join(guest, ".env"))).toBe(false)
    expect(readFileSync(join(source, ".git/config"), "utf8")).toBe(configBefore)
    expect(readFileSync(join(source, "README.md"), "utf8")).toBe("host edits stay here")
    writeFileSync(join(guest, "README.md"), "independent guest edit")
    expect(readFileSync(join(source, "README.md"), "utf8")).toBe("host edits stay here")
  } finally {
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)
