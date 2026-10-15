const net = require("node:net")
const fs = require("node:fs/promises")
const path = require("node:path")
const { setTimeout: sleep } = require("node:timers/promises")

const thread = process.argv[2]
const tokenPath = process.argv[3] || process.env.TOURI_MCP_TOKEN_FILE
const runDir = process.env.TOURI_RUN_DIR || "/workspace/.touri/run"
const fail = (message, stage = "unknown") => {
  process.stderr.write(`touri MCP startup failed: ${stage} (${message})\n`)
  process.exitCode = 1
}

async function main() {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(thread || "")) return fail("invalid thread id")
  const name = typeof tokenPath === "string" ? path.basename(tokenPath) : ""
  const match = name.match(/^([a-zA-Z0-9_-]+)\.([a-f0-9]{32})\.token$/)
  if (!match || match[1] !== thread || path.dirname(path.resolve(tokenPath)) !== path.resolve(runDir))
    return fail("a per-run token file in TOURI_RUN_DIR is required", "token_unavailable")

  // Startup can precede the atomic guest write. Bound the wait below MCP's handshake timeout.
  const deadline = Date.now() + 2000
  let token
  while (!token) {
    try {
      token = (await fs.readFile(tokenPath, "utf8")).trim()
      if (!token) throw Object.assign(new Error("empty token file"), { code: "EMPTY" })
    } catch (error) {
      if (!["ENOENT", "EMPTY"].includes(error.code) || Date.now() >= deadline)
        return fail(
          `unable to read per-run token after up to 2000 ms (${error.code || "read error"}); retry the turn`,
          "token_unavailable",
        )
      await sleep(50)
    }
  }
  const socket = net.createConnection(process.env.TOURI_MCP_SOCK || "/tmp/touri-mcp.sock", () => {
    socket.write(`${JSON.stringify({ role: "client" })}\n`)
    socket.write(`${JSON.stringify({ touriAuth: { thread, token, tokenId: match[2] } })}\n`)
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
  })
  let initialized = false
  socket.on("data", () => {
    initialized = true
  })
  socket.on("error", (error) => {
    fail(`bridge connection failed (${error.code || "socket error"})`, "socket_error")
    process.stdin.destroy()
  })
  socket.on("close", () => {
    if (!initialized && !process.exitCode)
      fail("bridge closed before the initialize response; retry the turn", "bridge_closed")
    process.stdin.destroy()
  })
}

main().catch(() => fail("unexpected startup error; retry the turn"))
