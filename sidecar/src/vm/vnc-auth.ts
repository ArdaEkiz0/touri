import { createCipheriv } from "node:crypto"

const reverseBits = (byte: number): number => {
  let reversed = 0
  for (let bit = 0; bit < 8; bit += 1) reversed = (reversed << 1) | ((byte >> bit) & 1)
  return reversed
}
const encrypt = (key: Buffer, bytes: Buffer): Buffer => {
  // Three equal DES keys reduce EDE to DES; this name works in Bun and Node/OpenSSL.
  const cipher = createCipheriv("des-ede3", Buffer.concat([key, key, key]), null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(bytes), cipher.final()])
}
const passwordBytes = (password: string): Buffer => {
  if (!/^[\x21-\x7e]{8}$/.test(password)) throw new Error("Senha da tela inválida")
  return Buffer.from(password, "ascii")
}

/** The standard rfbauth file is obscured with a fixed DES key, so keep it private. */
export const vncPasswordFile = (password: string): Buffer =>
  encrypt(Buffer.from([23, 82, 107, 6, 35, 78, 88, 7].map(reverseBits)), passwordBytes(password))

export const vncResponse = (password: string, challenge: Buffer): Buffer => {
  if (challenge.length !== 16) throw new Error("Desafio da tela inválido")
  return encrypt(Buffer.from(passwordBytes(password).map(reverseBits)), challenge)
}

/** Only the sidecar answers the upstream challenge; never expose it to the viewer. */
export class VncAuthenticator {
  private pending = Buffer.alloc(0)
  private phase: "version" | "security" | "challenge" | "result" | "ready" = "version"

  constructor(
    private password: string,
    private readonly write: (bytes: Buffer) => void,
  ) {
    passwordBytes(password)
  }

  get authenticated(): boolean {
    return this.phase === "ready"
  }

  push(bytes: Uint8Array): Buffer {
    if (this.authenticated) return Buffer.from(bytes)
    if (this.pending.length + bytes.length > 1_048_576) throw new Error("Pacote da tela excede o limite")
    this.pending = Buffer.concat([this.pending, bytes])
    while (true) {
      const length =
        this.phase === "version"
          ? 12
          : this.phase === "security"
            ? 1 + (this.pending[0] ?? 255)
            : this.phase === "challenge"
              ? 16
              : 4
      if (this.pending.length < length) return Buffer.alloc(0)
      const packet = this.pending.subarray(0, length)
      this.pending = this.pending.subarray(length)
      if (this.phase === "version") {
        if (packet.toString() !== "RFB 003.008\n") throw new Error("Versão da tela incompatível")
        this.phase = "security"
        this.write(Buffer.from(packet))
      } else if (this.phase === "security") {
        if (!packet.subarray(1).includes(2)) throw new Error("Autenticação da tela obrigatória")
        this.phase = "challenge"
        this.write(Buffer.from([2]))
      } else if (this.phase === "challenge") {
        this.phase = "result"
        this.write(vncResponse(this.password, packet))
        this.password = ""
      } else {
        if (packet.readUInt32BE(0) !== 0) throw new Error("Autenticação da tela recusada")
        this.phase = "ready"
        const rest = this.pending
        this.pending = Buffer.alloc(0)
        return rest
      }
    }
  }
}
