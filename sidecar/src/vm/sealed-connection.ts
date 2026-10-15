import { createCipheriv, createHash, randomBytes } from "node:crypto"
import type { Kernel, MachineConnection } from "@touri/contracts"

export type ConnectionKeys = {
  rotate: (machineId: string) => Promise<Buffer>
  remove: (machineId: string) => Promise<void>
}

export const connectionKeyId = (key: Buffer) => createHash("sha256").update(key).digest("hex")
export const connectionKeyAccount = (machineId: string) => `vm-connection/${machineId}`

export const keychainConnectionKeys = (kernel: Pick<Kernel, "callHost" | "addRedactionValue">): ConnectionKeys => ({
  async rotate(machineId) {
    const key = randomBytes(32)
    const value = key.toString("base64")
    kernel.addRedactionValue(value)
    try {
      const result = await kernel.callHost("keychain.set", { account: connectionKeyAccount(machineId), value })
      if (!result.success) throw new Error("Não foi possível guardar a chave da conexão no Chaves do macOS")
      return key
    } catch (error) {
      key.fill(0)
      throw error
    }
  },
  async remove(machineId) {
    const result = await kernel.callHost("keychain.delete", { account: connectionKeyAccount(machineId) })
    if (!result.success) throw new Error("Não foi possível remover a chave da conexão do Chaves do macOS")
  },
})

// The key is rotated on every boot and re-rotated after a sidecar restart, so it
// never has to outlive this process. Keeping it in memory avoids blocking a VM
// boot on the macOS Keychain (ad-hoc builds change signature on every rebuild).
export const memoryConnectionKeys = (kernel: Pick<Kernel, "addRedactionValue">): ConnectionKeys => {
  const keys = new Map<string, Buffer>()
  return {
    async rotate(machineId) {
      keys.get(machineId)?.fill(0)
      const key = randomBytes(32)
      kernel.addRedactionValue(key.toString("base64"))
      keys.set(machineId, key)
      return key
    },
    async remove(machineId) {
      keys.get(machineId)?.fill(0)
      keys.delete(machineId)
    },
  }
}

// The authenticated header binds the file to one machine and one key generation.
export const sealConnection = ({
  connection,
  token,
  key,
  desktopPasswordFile,
  fence,
}: {
  connection: MachineConnection
  token: string
  key: Buffer
  desktopPasswordFile?: string
  fence?: { generation: number; expiresAt: string }
}): string => {
  if (key.length !== 32 || connection.authKeyId !== connectionKeyId(key)) throw new Error("Chave da conexão inválida")
  if (
    fence &&
    (!Number.isSafeInteger(fence.generation) ||
      fence.generation < 1 ||
      !Number.isFinite(Date.parse(fence.expiresAt)) ||
      Date.parse(fence.expiresAt) <= Date.now())
  )
    throw new Error("Fence da conexão inválido")
  const header = {
    ...(fence ?? {}),
    version: fence ? 2 : 1,
    algorithm: "aes-256-gcm",
    machineId: connection.machineId,
    keyId: connection.authKeyId,
  }
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, nonce)
  cipher.setAAD(Buffer.from(JSON.stringify(header)))
  const ciphertext = Buffer.concat([
    cipher.update(
      JSON.stringify({ connection, token, ...(desktopPasswordFile ? { desktopPasswordFile } : {}) }),
      "utf8",
    ),
    cipher.final(),
  ])
  return JSON.stringify({
    ...header,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  })
}
