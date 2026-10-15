import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import type { Kernel, MachineConnection } from "@touri/contracts"
import { machineConnection } from "../../src/vm/connection"
import {
  connectionKeyId,
  keychainConnectionKeys,
  memoryConnectionKeys,
  sealConnection,
} from "../../src/vm/sealed-connection"

const openConnection = async (
  envelope: object,
  key: Buffer,
  machineId: string,
): Promise<{ connection: MachineConnection; token: string; desktopPasswordFile?: string }> => {
  const child = Bun.spawn(
    [
      Bun.which("node") ?? "node",
      "-e",
      "let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{const value=JSON.parse(input);try{const opened=require(process.argv[1]).openConnection(value.envelope,Buffer.from(value.key,'base64'),value.machineId);process.stdout.write(JSON.stringify(opened))}catch{process.exit(1)}})",
      join(import.meta.dir, "../../src/vm/image/connection.cjs"),
    ],
    {
      stdin: new Response(JSON.stringify({ envelope, key: key.toString("base64"), machineId })),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
  if (code !== 0) throw new Error("Guest rejected connection")
  return JSON.parse(output)
}
const fixture = () => {
  const key = randomBytes(32)
  const connection = machineConnection({
    id: "test-machine",
    provider: "test",
    ports: [],
    authKeyId: connectionKeyId(key),
  })
  const token = randomBytes(32).toString("hex")
  const sealed = sealConnection({ connection, token, key })
  return { key, connection, token, sealed, envelope: JSON.parse(sealed) as Record<string, unknown> }
}

test("the guest decrypts the host AES-256-GCM envelope; disk contains no plaintext token or key", async () => {
  const f = fixture()
  expect(await openConnection(f.envelope, f.key, f.connection.machineId)).toEqual({
    connection: f.connection,
    token: f.token,
  })
  expect(f.sealed).not.toContain(f.token)
  expect(f.sealed).not.toContain(f.key.toString("base64"))
  expect(f.sealed).not.toContain(f.connection.bridge.socketPath)
  expect(sealConnection(f)).not.toBe(f.sealed)
})

test("VNC credentials travel only inside the sealed payload, never the public connection", async () => {
  const f = fixture()
  const desktopPasswordFile = "1TKd8oNwOOg="
  const sealed = sealConnection({ ...f, desktopPasswordFile })
  expect(sealed).not.toContain(desktopPasswordFile)
  expect(JSON.stringify(f.connection)).not.toContain(desktopPasswordFile)
  expect(await openConnection(JSON.parse(sealed), f.key, f.connection.machineId)).toMatchObject({ desktopPasswordFile })
})

test.each(["version", "algorithm", "machineId", "keyId", "nonce", "ciphertext", "tag"])(
  "the guest rejects a modified %s",
  async (field) => {
    const f = fixture()
    const modified = { ...f.envelope, [field]: field === "version" ? 2 : "AAAAAAAAAAAAAAAAAAAAAA==" }
    await expect(openConnection(modified, f.key, f.connection.machineId)).rejects.toThrow()
  },
)

test("wrong machine, rotated key and truncated keys cannot open the old connection", async () => {
  const f = fixture()
  await expect(openConnection(f.envelope, f.key, "another-machine")).rejects.toThrow()
  await expect(openConnection(f.envelope, randomBytes(32), f.connection.machineId)).rejects.toThrow()
  expect(() => sealConnection({ ...f, key: randomBytes(16) })).toThrow()
})

test("production keys use the authenticated host Keychain bridge and have no fallback", async () => {
  const calls: Array<{ method: string; params: unknown }> = []
  const redactions: string[] = []
  const kernel: Pick<Kernel, "callHost" | "addRedactionValue"> = {
    addRedactionValue: (value) => {
      redactions.push(value)
    },
    callHost: async (method, params) => {
      calls.push({ method, params })
      return { success: true, value: {} } as never
    },
  }
  const keys = keychainConnectionKeys(kernel)
  const first = await keys.rotate("machine")
  const second = await keys.rotate("machine")
  expect(first.length).toBe(32)
  expect(connectionKeyId(first)).not.toBe(connectionKeyId(second))
  expect(calls[0]).toEqual({
    method: "keychain.set",
    params: { account: "vm-connection/machine", value: first.toString("base64") },
  })
  expect(redactions).toContain(first.toString("base64"))
  await keys.remove("machine")
  expect(calls[2]).toEqual({ method: "keychain.delete", params: { account: "vm-connection/machine" } })
  kernel.callHost = async () => ({ success: false, errorCode: "HOST_UNAVAILABLE", error: "offline" })
  await expect(keys.rotate("machine")).rejects.toThrow("Chaves do macOS")
})

test("memory connection keys rotate per machine without the Keychain and wipe on remove", async () => {
  const redacted: string[] = []
  const keys = memoryConnectionKeys({ addRedactionValue: (value: string) => redacted.push(value) })
  const first = await keys.rotate("vm-a")
  const second = await keys.rotate("vm-a")
  expect(first.equals(Buffer.alloc(32))).toBe(true)
  expect(second.length).toBe(32)
  expect(redacted).toContain(second.toString("base64"))
  await keys.remove("vm-a")
  expect(second.equals(Buffer.alloc(32))).toBe(true)
})
