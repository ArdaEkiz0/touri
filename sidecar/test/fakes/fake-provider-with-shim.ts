import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const main = join(import.meta.dir, "..", "..", "src", "main.ts")
const detached = process.env.FAKE_SHIM_DETACHED === "1"
const shim = spawn("bun", ["run", main, "mcp-stdio", "--thread", "thread-orphan"], {
  stdio: ["pipe", "ignore", "ignore"],
  detached,
  env: process.env,
})
writeFileSync(process.env.FAKE_SHIM_PID_FILE ?? "", String(shim.pid))
if (process.env.FAKE_PROVIDER_EXITS === "1") setTimeout(() => process.exit(0), 300)
setInterval(() => undefined, 1_000)
