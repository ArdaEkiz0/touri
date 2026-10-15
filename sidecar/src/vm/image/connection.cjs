const crypto = require("node:crypto")

exports.openConnection = (envelope, key, machineId, fence) => {
  const header = {
    ...(envelope.version === 2 ? { generation: envelope.generation, expiresAt: envelope.expiresAt } : {}),
    version: envelope.version,
    algorithm: envelope.algorithm,
    machineId: envelope.machineId,
    keyId: envelope.keyId,
  }
  const keyId = crypto.createHash("sha256").update(key).digest("hex")
  if (
    key.length !== 32 ||
    (header.version !== 1 && header.version !== 2) ||
    (header.version === 2 &&
      (!fence ||
        !Number.isSafeInteger(envelope.generation) ||
        envelope.generation !== fence.generation ||
        !Number.isFinite(Date.parse(envelope.expiresAt)) ||
        Date.parse(envelope.expiresAt) <= Date.now())) ||
    header.algorithm !== "aes-256-gcm" ||
    header.machineId !== machineId ||
    header.keyId !== keyId
  )
    throw new Error("Conexão inválida")
  const nonce = Buffer.from(envelope.nonce, "base64")
  const tag = Buffer.from(envelope.tag, "base64")
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("Conexão inválida")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce)
  decipher.setAAD(Buffer.from(JSON.stringify(header)))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()])
  const value = JSON.parse(plaintext.toString("utf8"))
  if (
    value.connection.machineId !== machineId ||
    value.connection.authKeyId !== keyId ||
    typeof value.token !== "string" ||
    value.token.length !== 64
  )
    throw new Error("Conexão inválida")
  return value
}
