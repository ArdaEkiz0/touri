import { expect, test } from "bun:test"
import { spawnTree } from "../../src/kernel/spawn"

const environment = (): Record<string, string> => ({ PATH: process.env.PATH ?? "/usr/bin" })

const readFirstLine = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  let text = ""
  while (!text.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) break
    text += new TextDecoder().decode(chunk.value)
  }
  reader.releaseLock()
  return text.slice(0, text.indexOf("\n"))
}

test("spawnTree starts a process group and kill takes down grandchildren", async () => {
  const child = spawnTree({
    cmd: "/bin/sh",
    args: ["-c", "sleep 30 & printf '%s\\n' $!; wait"],
    cwd: process.cwd(),
    env: environment(),
  })
  expect(child.success).toBe(true)
  if (!child.success) return
  const grandchildPid = Number((await readFirstLine(child.stdout)).trim())
  expect(child.pgid).toBe(child.pid)
  const ps = Bun.spawnSync({ cmd: ["/bin/ps", "-o", "pgid=", "-p", String(child.pid)], stdout: "pipe", stderr: "pipe" })
  expect(new TextDecoder().decode(ps.stdout).trim()).toBe(String(child.pid))
  child.kill("SIGTERM")
  await child.exited
  const isAlive = (): boolean => {
    try {
      process.kill(grandchildPid, 0)
      return true
    } catch {
      return false
    }
  }
  const deadline = Date.now() + 2000
  while (isAlive() && Date.now() < deadline) await Bun.sleep(25)
  expect(isAlive()).toBe(false)
})

test("spawnTree extra fd is a bidirectional pipe", async () => {
  const child = spawnTree({
    cmd: "/bin/sh",
    args: ["-c", "read line <&3; printf 'echo:%s\\n' \"$line\" >&3"],
    cwd: process.cwd(),
    env: environment(),
    extraFds: 1,
  })
  expect(child.success).toBe(true)
  if (!child.success) return
  const extra = child.extra[0]
  expect(extra).not.toBeUndefined()
  if (!extra?.read || !extra.write) return
  const writer = extra.write.getWriter()
  try {
    await writer.write(new TextEncoder().encode("round-trip\n"))
    const output = await new Response(extra.read).text()
    expect(output).toBe("echo:round-trip\n")
    await child.exited
  } finally {
    await writer.close()
    writer.releaseLock()
    child.kill("SIGTERM")
    await child.exited
  }
})

test("spawnTree returns ENOENT for a missing executable", () => {
  const child = spawnTree({ cmd: "/definitely/missing/touri-child", args: [], cwd: process.cwd(), env: environment() })
  expect(child).toMatchObject({ success: false, errorCode: "ENOENT" })
})

test("extra pipes apply backpressure instead of buffering all child output without a consumer", async () => {
  const child = spawnTree({
    cmd: "/bin/sh",
    args: ["-c", "head -c 8388608 /dev/zero >&3; printf 'done\\n'; sleep 30"],
    cwd: process.cwd(),
    env: environment(),
    extraFds: 1,
  })
  if (!child.success) throw new Error(child.error)
  const pipe = child.extra[0]
  if (!pipe?.read || !pipe.write) throw new Error("extra pipe missing")
  let completed = false
  const done = readFirstLine(child.stdout).then((line) => {
    completed = true
    return line
  })
  try {
    await Bun.sleep(200)
    expect(completed).toBe(false)
    const reader = pipe.read.getReader()
    let bytes = 0
    try {
      while (bytes < 8388608) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
      }
      expect(bytes).toBe(8388608)
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    expect(await done).toBe("done")
  } finally {
    await pipe.write.abort()
    child.kill("SIGTERM")
    await child.exited
  }
})

test("spawnTree reports a missing working directory instead of a missing binary", () => {
  const child = spawnTree({ cmd: "/bin/echo", args: ["x"], cwd: "/nonexistent/touri-cwd", env: environment() })
  expect(child.success).toBe(false)
  if (child.success) return
  expect(child.error).toContain("Working directory does not exist")
})
