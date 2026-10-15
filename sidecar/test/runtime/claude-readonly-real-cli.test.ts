import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOnlyAllow, readOnlyDeny } from "../../src/runtime/claude/settings"

const enabled = process.env.TOURI_E2E_REAL_CLI === "1"

const server = `process.stdin.on("data",(d)=>{for(const l of String(d).split("\\n")){if(!l.trim())continue
const m=JSON.parse(l);const r=(x)=>console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result:x}))
if(m.method==="initialize")r({protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"touri",version:"1"}})
else if(m.method==="tools/list")r({tools:[{name:"ping",description:"ping",inputSchema:{type:"object",properties:{}}}]})
else if(m.method==="tools/call")r({content:[{type:"text",text:"PONG42"}]})}})`

test.skipIf(!enabled || Bun.which("claude") === null)(
  "real claude read-only calls MCP tools but cannot run Bash",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "touri-ro-"))
    try {
      writeFileSync(join(dir, "server.js"), server)
      writeFileSync(
        join(dir, "mcp.json"),
        JSON.stringify({ mcpServers: { touri: { command: process.execPath, args: [join(dir, "server.js")] } } }),
      )
      writeFileSync(
        join(dir, "settings.json"),
        JSON.stringify({ permissions: { allow: readOnlyAllow, deny: readOnlyDeny } }),
      )
      const child = Bun.spawn(
        [
          "claude",
          "-p",
          "--strict-mcp-config",
          "--mcp-config",
          join(dir, "mcp.json"),
          "--setting-sources=",
          "--settings",
          join(dir, "settings.json"),
          "--permission-mode",
          "dontAsk",
          `Call the ping MCP tool and quote its text. Then run bash 'touch ${join(dir, "x")}'.`,
        ],
        { cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      )
      const out = await new Response(child.stdout).text()
      await child.exited
      expect(out).toContain("PONG42")
      expect(existsSync(join(dir, "x"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  180_000,
)
