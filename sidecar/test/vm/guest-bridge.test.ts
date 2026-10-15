import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnTree } from "../../src/kernel/spawn"
import { configureBridge } from "../../src/vm/configure-bridge"
import { machineConnection } from "../../src/vm/connection"
import { connectionKeyId, sealConnection } from "../../src/vm/sealed-connection"
import { vncPasswordFile } from "../../src/vm/vnc-auth"
import { fakeVmProvider } from "./fake-provider"

const waitText = (socket: Socket, expected: string) =>
  new Promise<string>((resolve, reject) => {
    let value = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("Bridge response timed out"))
    }, 3000)
    const read = (chunk: Buffer) => {
      value += chunk.toString()
      if (!value.includes(expected)) return
      clearTimeout(timer)
      socket.removeListener("data", read)
      resolve(value)
    }
    socket.on("data", read)
    socket.on("error", reject)
  })

test("the real guest bridge configures from stdin, authenticates hosts and relays the original MCP protocol", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-sealed-bridge-"))
  const socketPath = join(root, "mcp.sock")
  const file = join(root, "connection.json")
  const passwordPath = join(root, "passwd")
  const reservation = createServer()
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const address = reservation.address()
  if (!address || typeof address === "string") throw new Error("Missing test port")
  const guestPort = address.port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const node = Bun.which("node") ?? "node"
  const child = Bun.spawn(
    [node, join(import.meta.dir, "../../src/vm/image/mcp-bridge.cjs"), socketPath, String(guestPort), passwordPath],
    { stdout: "pipe", stderr: "pipe" },
  )
  const sockets: Socket[] = []
  const provider = fakeVmProvider().provider
  provider.spawn = (input) =>
    spawnTree({ cmd: node, args: input.args ?? [], cwd: root, env: { PATH: "/usr/bin:/bin" } })
  const connect = (local: boolean) => {
    const socket = local ? createConnection(socketPath) : createConnection(guestPort, "127.0.0.1")
    sockets.push(socket)
    return socket
  }
  try {
    const readyDeadline = Date.now() + 20_000
    while (!existsSync(socketPath) && child.exitCode === null && Date.now() < readyDeadline) await Bun.sleep(25)
    expect(existsSync(socketPath)).toBe(true)
    for (let i = 0; i < 100 && (statSync(socketPath).mode & 0o777) !== 0o600; i++) await Bun.sleep(10)
    expect(statSync(socketPath).mode & 0o777).toBe(0o600)
    const key = randomBytes(32)
    const token = randomBytes(32).toString("hex")
    const connection = machineConnection({
      id: "bridge-test",
      provider: "test",
      ports: [],
      authKeyId: connectionKeyId(key),
    })
    connection.bridge = { guestPort, socketPath, connectionFile: file }
    const passwordFile = vncPasswordFile("touri123")
    writeFileSync(
      file,
      sealConnection({ connection, token, key, desktopPasswordFile: passwordFile.toString("base64") }),
      { mode: 0o600 },
    )
    await configureBridge({ provider, connection, key, signal: AbortSignal.timeout(3000) })
    expect(readFileSync(passwordPath).equals(passwordFile)).toBe(true)
    expect(statSync(passwordPath).mode & 0o777).toBe(0o600)
    const invalid = connect(false)
    const rejected = new Promise<void>((resolve) => invalid.once("close", resolve))
    invalid.write(`${JSON.stringify({ role: "host", token: "incorrect" })}\n`)
    await rejected
    const host = connect(false)
    const hostData = waitText(host, '"touriAuth"')
    host.write(`${JSON.stringify({ role: "host", token })}\n`)
    const client = connect(true)
    const message = `${JSON.stringify({ touriAuth: { thread: "test", token: "thread-secret" }, data: "x".repeat(8000) })}\n`
    client.write(`${JSON.stringify({ role: "client" })}\n${message}`)
    expect(await hostData).toContain("paired\n")
    const clientData = waitText(client, "gateway-reply")
    host.write("gateway-reply\n")
    expect(await clientData).toBe("gateway-reply\n")
    writeFileSync(file, sealConnection({ connection, token, key, desktopPasswordFile: "invalid" }))
    await expect(configureBridge({ provider, connection, key, signal: AbortSignal.timeout(3000) })).rejects.toThrow(
      "recusou",
    )
    expect(readFileSync(passwordPath).equals(passwordFile)).toBe(true)
    const changed = JSON.parse(sealConnection({ connection, token, key }))
    changed.tag = randomBytes(16).toString("base64")
    writeFileSync(file, JSON.stringify(changed))
    await expect(configureBridge({ provider, connection, key, signal: AbortSignal.timeout(3000) })).rejects.toThrow(
      "recusou",
    )
    const nextKey = randomBytes(32)
    connection.authKeyId = connectionKeyId(nextKey)
    connection.bridge.guestPort = guestPort + 1
    writeFileSync(file, sealConnection({ connection, token, key: nextKey }))
    await expect(
      configureBridge({ provider, connection, key: nextKey, signal: AbortSignal.timeout(3000) }),
    ).rejects.toThrow("recusou")
    connection.bridge.guestPort = guestPort
    const nextPasswordFile = vncPasswordFile("next1234")
    writeFileSync(
      file,
      sealConnection({
        connection,
        token: randomBytes(32).toString("hex"),
        key: nextKey,
        desktopPasswordFile: nextPasswordFile.toString("base64"),
      }),
    )
    await configureBridge({ provider, connection, key: nextKey, signal: AbortSignal.timeout(3000) })
    expect(readFileSync(passwordPath).equals(nextPasswordFile)).toBe(true)
    expect(statSync(passwordPath).mode & 0o777).toBe(0o600)
    const old = connect(false)
    const oldRejected = new Promise<void>((resolve) => old.once("close", resolve))
    old.write(`${JSON.stringify({ role: "host", token })}\n`)
    await oldRejected
  } finally {
    for (const socket of sockets) socket.destroy()
    child.kill()
    await child.exited
    rmSync(root, { recursive: true, force: true })
  }
})
