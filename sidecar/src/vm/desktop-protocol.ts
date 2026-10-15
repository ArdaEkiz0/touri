const MAX_PACKET = 1_048_576

/** RFB 3.8 / None authentication. Parse the byte stream, never assume WS frames are RFB records. */
export class DesktopInputGate {
  private pending = Buffer.alloc(0)
  private phase: "version" | "security" | "init" | "messages" = "version"
  private keys = new Map<number, Buffer>()
  private pointer: Buffer | null = null

  constructor(
    private readonly onViewerHandshake?: (phase: "version" | "security") => void,
    private readonly onFrameRequest?: (packet: Buffer) => void,
  ) {}

  push(bytes: Uint8Array, control: boolean): Buffer {
    if (this.pending.length + bytes.length > MAX_PACKET) throw new Error("Pacote da tela excede o limite")
    this.pending = Buffer.concat([this.pending, bytes])
    const output: Array<Buffer> = []
    while (this.pending.length) {
      let length: number
      let input = false
      let handshake = false
      if (this.phase === "version") {
        handshake = true
        length = 12
        if (this.pending.length < length) break
        if (this.pending.subarray(0, length).toString() !== "RFB 003.008\n")
          throw new Error("Versão da tela incompatível")
        this.phase = "security"
        this.onViewerHandshake?.("version")
      } else if (this.phase === "security") {
        handshake = true
        length = 1
        if (this.pending[0] !== 1) throw new Error("Autenticação da tela incompatível")
        this.phase = "init"
        this.onViewerHandshake?.("security")
      } else if (this.phase === "init") {
        length = 1
        if (this.pending[0] !== 0 && this.pending[0] !== 1) throw new Error("Inicialização da tela incompatível")
        this.phase = "messages"
      } else {
        const type = this.pending[0]
        switch (type) {
          case 0:
            length = 20
            break
          case 2:
            if (this.pending.length < 4) return Buffer.concat(output)
            length = 4 + this.pending.readUInt16BE(2) * 4
            break
          case 3:
          case 150:
            length = 10
            break
          case 4:
            length = 8
            input = true
            break
          case 5:
            if (this.pending.length < 2) return Buffer.concat(output)
            length = (this.pending[1] ?? 0) & 0x80 ? 7 : 6
            input = true
            break
          case 6:
            if (this.pending.length < 8) return Buffer.concat(output)
            length = 8 + Math.abs(this.pending.readInt32BE(4))
            input = true
            break
          case 248:
            if (this.pending.length < 9) return Buffer.concat(output)
            length = 9 + (this.pending[8] ?? 0)
            break
          case 255:
            if (this.pending.length < 2) return Buffer.concat(output)
            if (this.pending[1] !== 0) throw new Error("Evento da tela desconhecido")
            length = 12
            input = true
            break
          default:
            throw new Error("Evento da tela desconhecido")
        }
      }
      if (length > MAX_PACKET) throw new Error("Pacote da tela excede o limite")
      if (this.pending.length < length) break
      const packet = Buffer.from(this.pending.subarray(0, length))
      this.pending = this.pending.subarray(length)
      if (handshake && this.onViewerHandshake) continue
      if (input && !control) continue
      if (this.onFrameRequest && this.phase === "messages") {
        if (packet[0] === 3) {
          this.onFrameRequest(packet)
          continue
        }
        if (packet[0] === 150) continue
        if (packet[0] === 2) {
          const encodings: Buffer[] = []
          for (let offset = 4; offset < packet.length; offset += 4)
            if (packet.readInt32BE(offset) !== -313) encodings.push(packet.subarray(offset, offset + 4))
          const header = Buffer.from([2, 0, 0, 0])
          header.writeUInt16BE(encodings.length, 2)
          output.push(Buffer.concat([header, ...encodings]))
          continue
        }
      }
      if (packet[0] === 4 && this.phase === "messages" && packet.length === 8) {
        const key = packet.readUInt32BE(4)
        if (packet[1]) this.keys.set(key, packet)
        else this.keys.delete(key)
      } else if (packet[0] === 255 && packet.length === 12) {
        const key = packet.readUInt32BE(4)
        if (packet.readUInt16BE(2)) this.keys.set(key, packet)
        else this.keys.delete(key)
      } else if (packet[0] === 5) this.pointer = packet
      if (this.keys.size > 256) throw new Error("Teclas da tela excedem o limite")
      output.push(packet)
    }
    return Buffer.concat(output)
  }

  /** Release held keys/buttons before a control session closes, including an emergency stop. */
  releases(): Buffer {
    const packets = [...this.keys.values()].map((packet) => {
      const release = Buffer.from(packet)
      if (release[0] === 255) release.writeUInt16BE(0, 2)
      else release[1] = 0
      return release
    })
    if (this.pointer) {
      const release = Buffer.from(this.pointer)
      release[1] = release.length === 7 ? 0x80 : 0
      if (release.length === 7) release[6] = 0
      packets.push(release)
    }
    this.keys.clear()
    this.pointer = null
    return Buffer.concat(packets)
  }
}
