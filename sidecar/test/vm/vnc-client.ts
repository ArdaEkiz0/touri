import { createConnection } from "node:net"
import { VncAuthenticator } from "../../src/vm/vnc-auth"

/** Attempts a real RFB login, including an explicit unauthenticated (None) login. */
export const attemptVnc = (port: number | string, password?: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket =
      typeof port === "string" ? createConnection({ path: port.slice(5) }) : createConnection(port, "127.0.0.1")
    const finish = (allowed: boolean) => {
      socket.destroy()
      resolve(allowed)
    }
    socket.setTimeout(5000, () => finish(false))
    socket.on("error", () => finish(false))
    socket.on("close", () => resolve(false))
    const auth = password ? new VncAuthenticator(password, (bytes) => socket.write(bytes)) : null
    let phase: "version" | "security" | "result" = "version"
    let pending = Buffer.alloc(0)
    socket.on("data", (data) => {
      try {
        if (auth) {
          auth.push(data)
          if (auth.authenticated) finish(true)
          return
        }
        pending = Buffer.concat([pending, data])
        while (pending.length) {
          const length = phase === "version" ? 12 : phase === "security" ? 1 + (pending[0] ?? 255) : 4
          if (pending.length < length) return
          const packet = pending.subarray(0, length)
          pending = pending.subarray(length)
          if (phase === "version") {
            phase = "security"
            socket.write(packet)
          } else if (phase === "security") {
            phase = "result"
            socket.write(Buffer.from([1]))
          } else return finish(packet.readUInt32BE(0) === 0)
        }
      } catch {
        finish(false)
      }
    })
  })

/** Completes a real RFB login and waits for the first FramebufferUpdate message. */
export const vncFirstFrame = (port: number | string, password: string, timeoutMs = 10_000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket =
      typeof port === "string" ? createConnection({ path: port.slice(5) }) : createConnection(port, "127.0.0.1")
    const finish = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.on("error", () => finish(false))
    socket.on("close", () => resolve(false))
    const auth = new VncAuthenticator(password, (bytes) => socket.write(bytes))
    let pending = Buffer.alloc(0)
    let phase: "init" | "name" | "frame" = "init"
    let sentInit = false
    socket.on("data", (data) => {
      try {
        const rest = auth.push(data)
        if (!auth.authenticated) return
        if (!sentInit) {
          sentInit = true
          socket.write(Buffer.from([1]))
        }
        pending = Buffer.concat([pending, rest])
        if (phase === "init" && pending.length >= 24) {
          const nameLength = pending.readUInt32BE(20)
          phase = "name"
          pending = pending.subarray(24)
          const request = Buffer.alloc(10)
          request.writeUInt8(3, 0)
          request.writeUInt16BE(1440, 6)
          request.writeUInt16BE(900, 8)
          socket.write(request)
          if (nameLength > pending.length) phase = "name"
          pending = pending.subarray(Math.min(nameLength, pending.length))
          phase = "frame"
        }
        if (phase === "frame" && pending.length > 0 && pending[0] === 0) finish(true)
      } catch {
        finish(false)
      }
    })
  })

// Bun's WebSocket accepts request headers; the desktop socket requires the app Origin like the UI.
const OriginWebSocket = WebSocket as unknown as new (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket

export type VncFrame = { width: number; height: number; rgba: Uint8Array }

/**
 * Speaks to the desktop gateway exactly like the UI's noVNC viewer (view-only), asks for
 * raw 32-bit pixels and returns the first complete framebuffer with any non-black pixel.
 */
export const desktopGatewayFrame = (url: string, origin: string, timeoutMs = 20_000): Promise<VncFrame> =>
  new Promise((resolve, reject) => {
    const socket = new OriginWebSocket(url, { headers: { Origin: origin } })
    socket.binaryType = "arraybuffer"
    let pending = Buffer.alloc(0)
    let phase: "version" | "security" | "result" | "init" | "messages" = "version"
    let width = 0
    let height = 0
    let rgba = new Uint8Array(0)
    const timer = setTimeout(() => finish(new Error("desktop gateway frame timeout")), timeoutMs)
    let settled = false
    const finish = (outcome: Error | VncFrame) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }
    const request = () => {
      const packet = Buffer.alloc(10)
      packet.writeUInt8(3, 0)
      packet.writeUInt8(0, 1)
      packet.writeUInt16BE(width, 6)
      packet.writeUInt16BE(height, 8)
      socket.send(packet)
    }
    const consumeUpdate = (): boolean => {
      if (pending.length < 4) return false
      const count = pending.readUInt16BE(2)
      let offset = 4
      const rects: Array<{ x: number; y: number; w: number; h: number; at: number }> = []
      for (let index = 0; index < count; index++) {
        if (pending.length < offset + 12) return false
        const x = pending.readUInt16BE(offset)
        const y = pending.readUInt16BE(offset + 2)
        const w = pending.readUInt16BE(offset + 4)
        const h = pending.readUInt16BE(offset + 6)
        const encoding = pending.readInt32BE(offset + 8)
        offset += 12
        if (encoding === -223) {
          width = w
          height = h
          rgba = new Uint8Array(width * height * 4)
          continue
        }
        if (encoding !== 0) throw new Error(`unexpected encoding ${encoding}`)
        if (pending.length < offset + w * h * 4) return false
        rects.push({ x, y, w, h, at: offset })
        offset += w * h * 4
      }
      for (const rect of rects)
        for (let row = 0; row < rect.h; row++)
          for (let column = 0; column < rect.w; column++) {
            const source = rect.at + (row * rect.w + column) * 4
            const target = ((rect.y + row) * width + rect.x + column) * 4
            rgba[target] = pending[source + 2] ?? 0
            rgba[target + 1] = pending[source + 1] ?? 0
            rgba[target + 2] = pending[source] ?? 0
            rgba[target + 3] = 255
          }
      pending = pending.subarray(offset)
      return true
    }
    const pump = () => {
      for (;;) {
        if (phase === "version") {
          if (pending.length < 12) return
          pending = pending.subarray(12)
          socket.send(Buffer.from("RFB 003.008\n"))
          phase = "security"
        } else if (phase === "security") {
          if (pending.length < 1 + (pending[0] ?? 0)) return
          pending = pending.subarray(1 + (pending[0] ?? 0))
          socket.send(Buffer.from([1]))
          phase = "result"
        } else if (phase === "result") {
          if (pending.length < 4) return
          if (pending.readUInt32BE(0) !== 0) return finish(new Error("security result failed"))
          pending = pending.subarray(4)
          socket.send(Buffer.from([1]))
          phase = "init"
        } else if (phase === "init") {
          if (pending.length < 24 || pending.length < 24 + pending.readUInt32BE(20)) return
          width = pending.readUInt16BE(0)
          height = pending.readUInt16BE(2)
          rgba = new Uint8Array(width * height * 4)
          pending = pending.subarray(24 + pending.readUInt32BE(20))
          const format = Buffer.alloc(20)
          format.writeUInt8(0, 0)
          format.writeUInt8(32, 4)
          format.writeUInt8(24, 5)
          format.writeUInt8(0, 6)
          format.writeUInt8(1, 7)
          format.writeUInt16BE(255, 8)
          format.writeUInt16BE(255, 10)
          format.writeUInt16BE(255, 12)
          format.writeUInt8(16, 14)
          format.writeUInt8(8, 15)
          format.writeUInt8(0, 16)
          socket.send(format)
          const encodings = Buffer.alloc(12)
          encodings.writeUInt8(2, 0)
          encodings.writeUInt16BE(2, 2)
          encodings.writeInt32BE(0, 4)
          encodings.writeInt32BE(-223, 8)
          socket.send(encodings)
          request()
          phase = "messages"
        } else {
          const type = pending[0]
          if (type === undefined) return
          if (type === 0) {
            if (!consumeUpdate()) return
            if (rgba.some((value, index) => index % 4 !== 3 && value > 16)) return finish({ width, height, rgba })
            setTimeout(request, 500)
          } else if (type === 2) pending = pending.subarray(1)
          else if (type === 3) {
            if (pending.length < 8 || pending.length < 8 + pending.readUInt32BE(4)) return
            pending = pending.subarray(8 + pending.readUInt32BE(4))
          } else return finish(new Error(`unexpected server message ${type}`))
        }
      }
    }
    socket.addEventListener("message", (event) => {
      pending = Buffer.concat([pending, Buffer.from(event.data as ArrayBuffer)])
      try {
        pump()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.addEventListener("error", () => finish(new Error("desktop gateway socket error")))
    socket.addEventListener("close", (event) => finish(new Error(`desktop gateway closed ${event.code}`)))
  })

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Buffer): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Encodes an RGBA frame as PNG without native dependencies. */
export const framePng = ({ width, height, rgba }: VncFrame): Buffer => {
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib")
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row++)
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(raw, row * (width * 4 + 1) + 1)
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(6, 9)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** Luminance variance of a frame; a black or flat screen is close to zero. */
export const frameVariance = ({ rgba }: { rgba: Uint8Array }): number => {
  let sum = 0
  let squares = 0
  let count = 0
  for (let index = 0; index < rgba.length; index += 16) {
    const luma = 0.299 * (rgba[index] ?? 0) + 0.587 * (rgba[index + 1] ?? 0) + 0.114 * (rgba[index + 2] ?? 0)
    sum += luma
    squares += luma * luma
    count += 1
  }
  const mean = sum / count
  return squares / count - mean * mean
}
