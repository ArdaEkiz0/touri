// The host opens outbound connections to this guest listener; no host LAN listener or DNS changes.
const net = require("node:net")
const fs = require("node:fs")
const { openConnection } = require("./connection.cjs")
const hosts = []
const clients = []
const sockets = new Set()
let token = null
let port = null
const guestPort = Number(process.argv[3] ?? 9876)
process.umask(0o077)
function pair() {
  while (hosts.length && clients.length) {
    const host = hosts.shift(),
      client = clients.shift()
    if (host.destroyed || client.destroyed) {
      if (!host.destroyed) hosts.unshift(host)
      if (!client.destroyed) clients.unshift(client)
      continue
    }
    host.write("paired\n")
    host.pipe(client)
    client.pipe(host)
    host.on("close", () => client.destroy())
    client.on("close", () => host.destroy())
    host.resume()
    client.resume()
  }
}
function accept(socket, local) {
  sockets.add(socket)
  socket.on("close", () => sockets.delete(socket))
  let buffer = Buffer.alloc(0)
  const read = (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const end = buffer.indexOf(10)
    if (end < 0) {
      if (buffer.length > 4096) socket.destroy()
      return
    }
    if (end > 4096) return socket.destroy()
    socket.pause()
    socket.removeListener("data", read)
    try {
      const hello = JSON.parse(buffer.subarray(0, end).toString())
      if (local && hello.role === "configure") {
        const key = Buffer.from(hello.key, "base64")
        try {
          const sealed = JSON.parse(fs.readFileSync(hello.path, "utf8"))
          const value = openConnection(sealed, key, hello.machineId)
          if (value.connection.bridge.guestPort !== guestPort || value.connection.bridge.socketPath !== socketPath)
            throw new Error("Ponte da conexão inválida")
          if (value.desktopPasswordFile !== undefined) {
            if (
              typeof value.desktopPasswordFile !== "string" ||
              !/^[A-Za-z0-9+/]{11}=$/.test(value.desktopPasswordFile)
            )
              throw new Error("Senha da tela inválida")
            const password = Buffer.from(value.desktopPasswordFile, "base64")
            const path = process.argv[4] ?? "/tmp/touri-vnc/passwd"
            const temporary = `${path}.${require("node:crypto").randomUUID()}`
            try {
              fs.writeFileSync(temporary, password, { mode: 0o600, flag: "wx" })
              fs.renameSync(temporary, path)
            } finally {
              password.fill(0)
              fs.rmSync(temporary, { force: true })
            }
          }
          fs.rmSync("/workspace/.touri/run/bridge-token", { force: true })
          for (const other of sockets) if (other !== socket) other.destroy()
          hosts.length = 0
          clients.length = 0
          token = value.token
          port = value.connection.bridge.guestPort
          socket.end("ready\n")
        } finally {
          key.fill(0)
        }
        return
      }
      const allowed = local ? hello.role === "client" : hello.role === "host" && hello.token === token
      if (!token || !allowed || port !== guestPort) return socket.destroy()
      if (buffer.length > end + 1) socket.unshift(buffer.subarray(end + 1))
      socket.setTimeout(0)
      ;(hello.role === "host" ? hosts : clients).push(socket)
      pair()
    } catch {
      socket.destroy()
    }
  }
  socket.setTimeout(10000, () => socket.destroy())
  socket.on("error", () => {})
  socket.on("data", read)
}
net.createServer((socket) => accept(socket, false)).listen(guestPort, "0.0.0.0")
const socketPath = process.argv[2] ?? "/tmp/touri-mcp.sock"
fs.rmSync(socketPath, { force: true })
net.createServer((socket) => accept(socket, true)).listen(socketPath, () => fs.chmodSync(socketPath, 0o600))
