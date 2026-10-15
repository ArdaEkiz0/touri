import { expect, test } from "bun:test"
import { createDecipheriv } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const init = readFileSync(join(import.meta.dir, "../../src/vm/image/init.sh"), "utf8")

test.skipIf(!Bun.which("x11vnc"))("guest starts with a full random password before sealed configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-vnc-init-"))
  try {
    const begin = init.indexOf("  umask 077")
    expect(begin).toBeGreaterThan(-1)
    expect(init.indexOf("vnc-password.cjs")).toBeLessThan(init.indexOf("x11vnc -norc"))
    const file = join(root, "passwd")
    const seed = [Bun.which("node") ?? "node", join(import.meta.dir, "../../src/vm/image/vnc-password.cjs"), file]
    const firstChild = Bun.spawn(seed, { stdout: "pipe", stderr: "pipe" })
    expect(await firstChild.exited).toBe(0)
    expect(await new Response(firstChild.stdout).text()).toBe("")
    expect(await new Response(firstChild.stderr).text()).toBe("")
    const first = readFileSync(file)
    expect(first).toHaveLength(8)
    const key = Buffer.from([232, 74, 214, 96, 196, 114, 26, 224])
    const decipher = createDecipheriv("des-ede3", Buffer.concat([key, key, key]), null)
    decipher.setAutoPadding(false)
    const plaintext = Buffer.concat([decipher.update(first), decipher.final()])
    expect(plaintext.toString()).toMatch(/^[A-Za-z0-9+/]{8}$/)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await Bun.spawn(seed).exited).toBe(0)
    expect(readFileSync(file)).not.toEqual(first)
    const listener = init.split("\n").find((line) => line.trim().startsWith("x11vnc ")) ?? ""
    expect(listener).toContain("-rfbauth /tmp/touri-vnc/passwd")
    expect(listener).toContain("-norc")
    expect(listener).not.toContain("-nopw")
    expect(listener).toContain("-xkb -add_keysyms")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("guest init cleanup command removes stale X locks and sockets before launching Xvfb", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-init-"))
  try {
    mkdirSync(join(root, ".X11-unix"))
    for (const name of [".X99-lock", ".X88-lock", ".X11-unix/X99", ".X11-unix/X88", "keep-me"])
      writeFileSync(join(root, name), "stale")
    const cleanup = init.split("\n").find((line) => line.startsWith("rm -f /tmp/.X"))
    expect(cleanup).toBeDefined()
    expect(init.indexOf(cleanup ?? "")).toBeLessThan(init.indexOf("Xvfb :99"))
    const child = Bun.spawn(["/bin/sh", "-c", (cleanup ?? "false").replaceAll("/tmp/", `${root}/`)])
    expect(await child.exited).toBe(0)
    for (const name of [".X99-lock", ".X88-lock", ".X11-unix/X99", ".X11-unix/X88"])
      expect(await Bun.file(join(root, name)).exists()).toBe(false)
    expect(await Bun.file(join(root, "keep-me")).text()).toBe("stale")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("guest init exits loudly if Xvfb dies instead of keeping only the MCP bridge alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-init-fail-"))
  try {
    writeFileSync(join(root, "Xvfb"), "#!/bin/sh\necho Xvfb-fatal >&2\nexit 1\n", { mode: 0o755 })
    writeFileSync(join(root, "xdotool"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    writeFileSync(join(root, "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    const body = init.slice(init.indexOf("/bin/sh -c '\n") + "/bin/sh -c '\n".length, init.lastIndexOf("'"))
    const child = Bun.spawn(
      [
        "/bin/sh",
        "-c",
        body
          .replaceAll("/tmp/", `${root}/`)
          .replaceAll("/run/touri-", `${root}/touri-`)
          .replaceAll("/usr/sbin/runuser -u node -- ", ""),
      ],
      {
        env: { PATH: `${root}:/usr/bin:/bin` },
        stderr: "pipe",
      },
    )
    expect(await child.exited).toBe(1)
    expect(await new Response(child.stderr).text()).toContain("Xvfb não iniciou")
    expect(await Bun.file(join(root, "touri-init-error")).text()).toContain("Xvfb não iniciou")
    expect(await Bun.file(join(root, "touri-ready")).exists()).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
