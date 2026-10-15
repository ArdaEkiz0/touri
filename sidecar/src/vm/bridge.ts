import { createConnection, type Socket } from "node:net"
import { MCP_LIMITS } from "../mcp/connection"

// Connect outward through a localhost guest port, then relay the original authenticated MCP protocol.
export const connectMcpBridge = ({
  port,
  token,
  socketPath,
  transport,
}: {
  transport?: string
  port: number
  token: string
  socketPath: string
}): (() => void) => {
  let stopped = false
  const sockets = new Set<Socket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const connect = () => {
    if (stopped) return
    const socket = createConnection(
      transport?.startsWith("unix:") ? { path: transport.slice(5) } : { host: "127.0.0.1", port },
    )
    const deadline = setTimeout(() => socket.destroy(), MCP_LIMITS.authMs)
    deadline.unref()
    sockets.add(socket)
    socket.once("connect", () => socket.write(`${JSON.stringify({ role: "host", token })}\n`))
    let buffer = Buffer.alloc(0)
    const paired = (chunk: Buffer) => {
      if (buffer.length + chunk.length > MCP_LIMITS.frameBytes + 100) return socket.destroy()
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) {
        if (buffer.length > 100) socket.destroy()
        return
      }
      socket.pause()
      socket.removeListener("data", paired)
      if (buffer.subarray(0, newline).toString() !== "paired") return socket.destroy()
      const upstream = createConnection(socketPath)
      sockets.add(upstream)
      upstream.on("error", () => socket.destroy())
      upstream.on("close", () => {
        sockets.delete(upstream)
        socket.destroy()
      })
      socket.on("close", () => upstream.destroy())
      upstream.once("connect", () => {
        clearTimeout(deadline)
        if (buffer.length > newline + 1) upstream.write(buffer.subarray(newline + 1))
        upstream.pipe(socket)
        socket.pipe(upstream)
        socket.resume()
      })
    }
    socket.on("data", paired)
    socket.on("error", () => socket.destroy())
    socket.on("close", () => {
      clearTimeout(deadline)
      sockets.delete(socket)
      if (stopped) return
      const timer = setTimeout(() => {
        timers.delete(timer)
        connect()
      }, 200)
      timers.add(timer)
    })
  }
  for (let index = 0; index < 4; index++) connect()
  return () => {
    stopped = true
    for (const timer of timers) clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
  }
}
