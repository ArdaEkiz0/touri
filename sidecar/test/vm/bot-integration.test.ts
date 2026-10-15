import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, ProviderEvent } from "@touri/contracts"
import { connectCdpWebSocket } from "../../src/browser/cdp"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { createCodexAdapter } from "../../src/runtime/codex/adapter"
import { sessionFingerprint } from "../../src/runtime/session"
import { init as initStore } from "../../src/store"
import { createAppleContainerProvider } from "../../src/vm"
import { createVmRuntime } from "../../src/vm/runtime"
import { appleContainerAvailable } from "./integration-available"

test.skipIf(!appleContainerAvailable)(
  "real bot VM: streaming CLI, persistent workspace, MCP bridge, Preview, warm boot, cleanup",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "tvmi-"))
    const runtime = createKernel({ appData: root })
    const provider = createAppleContainerProvider()
    const hostHome = join(root, "host-home")
    mkdirSync(join(hostHome, ".codex"), { recursive: true })
    writeFileSync(join(hostHome, ".codex/auth.json"), JSON.stringify({ OPENAI_API_KEY: "fake-integration-key" }), {
      mode: 0o600,
    })
    await initStore(runtime.kernel)
    await initMcp(runtime.kernel)
    const vm = createVmRuntime({
      kernel: runtime.kernel,
      provider,
      hostHome,
      connectionKeys: { rotate: async () => randomBytes(32), remove: async () => {} },
    })
    runtime.kernel.services.provide("vm.runtime", vm.service)
    let botId: string | null = null
    let prepared: Awaited<ReturnType<typeof vm.service.prepareTurn>> | null = null
    let mcpChild: ReturnType<typeof vm.service.spawn> | null = null
    try {
      const response = await fetch(`http://127.0.0.1:${runtime.handshake.port}/api/v1/bots`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dev-ui-token",
          "x-touri-client": "vm-test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Disposable VM", provider: "codex", machine: "vm", vmProviderLogin: true }),
      })
      expect(response.status).toBe(201)
      const bot = ((await response.json()) as { bot: Bot }).bot
      botId = bot.id
      ;(runtime.kernel.db as Database)
        .query("INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?)")
        .run(`vm-login-source:${bot.id}:codex`, '"host-file"', Date.now())
      const thread = runtime.kernel.services.use("store.api")?.getThread({ threadId: bot.mainThreadId ?? "" })
      if (!thread) throw new Error("Missing thread")
      const token = "a".repeat(64)
      writeFileSync(join(root, "run/mcp-tokens", thread.id), token, { mode: 0o600 })
      const start = performance.now()
      prepared = await vm.service.prepareTurn({ botId, threadId: thread.id, token })
      expect(
        (await vm.service.exec({ botId, command: "test", args: ["-r", "/home/node/.codex/auth.json"] })).success,
      ).toBe(true)
      expect((await vm.service.exec({ botId, command: "codex", args: ["login", "status"] })).success).toBe(true)
      // A private guest copy supports CLI refresh without modifying the host login.
      expect(
        (
          await vm.service.exec({
            botId,
            command: "/bin/sh",
            args: ["-c", "test -w /workspace/.home/.codex/auth.json"],
          })
        ).success,
      ).toBe(true)
      const firstCreateMs = performance.now() - start
      await vm.service.writeFile({
        botId,
        path: "/workspace/fake-codex.cjs",
        content: `
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
  const frame=JSON.parse(line);
  if(frame.id) send({id:frame.id,result:frame.method.startsWith('thread/')?{thread:{id:'guest-session'}}:{}});
  if(frame.method==='turn/start') {
    require('node:fs').writeFileSync('/workspace/persisted.txt',process.cwd());
    send({method:'turn/started',params:{turnId:'guest-turn'}});
    for(const delta of ['guest ',process.platform,' ',process.cwd()]) send({method:'item/agentMessage/delta',params:{itemId:'agent',delta}});
    send({method:'turn/completed',params:{status:'succeeded'}});
  }
});`,
      })
      const guest = prepared
      const events: Array<ProviderEvent> = []
      const adapter = createCodexAdapter({ kernel: runtime.kernel })
      const result = await adapter.startTurn({
        ...guest,
        thread,
        session: null,
        fingerprint: sessionFingerprint({
          bot: guest.bot,
          cwd: guest.cwd,
          mcpCommand: guest.mcp.command,
          mcpArgs: guest.mcp.args,
        }).fingerprint,
        input: [{ type: "text", text: "fake turn" }],
        developerInstructions: "test",
        handoffPacket: null,
        signal: AbortSignal.timeout(30_000),
        onEvent: (event) => events.push(event),
        execution: {
          ...guest.execution,
          spawn: (input) => guest.execution.spawn({ ...input, cmd: "node", args: ["/workspace/fake-codex.cjs"] }),
        },
      })
      if (!result.success) console.error("[fake CLI result]", result)
      expect(result.success).toBe(true)
      expect(
        events
          .filter((event) => event.type === "text_delta")
          .map((event) => event.delta)
          .join(""),
      ).toBe("guest linux /workspace")
      // Original MCP authentication goes end-to-end over the guest bridge.
      mcpChild = vm.service.spawn({
        botId,
        cmd: "node",
        args: guest.mcp.args,
        cwd: "/workspace",
        env: {},
      })
      if (!mcpChild.success) throw new Error(mcpChild.error)
      const writer = mcpChild.stdin.getWriter()
      await writer.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vm-test", version: "1" } } })}\n`,
        ),
      )
      const reader = mcpChild.stdout.getReader()
      let output = ""
      await Promise.race([
        (async () => {
          while (!output.includes('"id":1')) {
            const chunk = await reader.read()
            if (chunk.done) break
            output += new TextDecoder().decode(chunk.value)
          }
        })(),
        Bun.sleep(20_000).then(() => {
          throw new Error("MCP bridge timed out")
        }),
      ])
      expect(output).toContain('"serverInfo"')
      mcpChild.kill("SIGTERM")
      await reader.cancel()
      mcpChild = null
      const meta = (runtime.kernel.db as import("bun:sqlite").Database)
        .query("SELECT vm_id FROM bot_machines WHERE bot_id = ?")
        .get(botId) as { vm_id: string }
      expect(
        (
          await provider.exec({
            id: meta.vm_id,
            command: "node",
            args: ["-e", "require('http').createServer((_,r)=>r.end('guest-preview')).listen(3000,'0.0.0.0')"],
            detach: true,
            user: "1000",
          })
        ).success,
      ).toBe(true)
      const forwarded = await vm.service.forwardPort({ botId, guestPort: 3000 })
      expect(await (await fetch(forwarded.url, { signal: AbortSignal.timeout(5000) })).text()).toBe("guest-preview")
      const browserUrl = await vm.service.browserEndpoint({ botId })
      if (!browserUrl) throw new Error("Guest browser did not start")
      const browser = await connectCdpWebSocket({ url: browserUrl })
      try {
        expect((await browser.call<{ product: string }>("Browser.getVersion")).product).toMatch(/Chrome/)
      } finally {
        await browser.close()
      }
      for (const cli of ["codex", "claude", "pnpm"])
        expect((await vm.service.exec({ botId, command: cli, args: ["--version"] })).success).toBe(true)
      const help = await vm.service.exec({ botId, command: "codex", args: ["app-server", "--help"] })
      expect(help.success && help.stdout).toContain("--stdio")
      const ram = await vm.service.exec({ botId, command: "cat", args: ["/proc/meminfo"] })
      // Leave inert stale X artifacts in this disposable guest across its warm start.
      expect(
        (await vm.service.exec({ botId, command: "touch", args: ["/tmp/.X88-lock", "/tmp/.X11-unix/X88"] })).success,
      ).toBe(true)
      await prepared.release()
      prepared = null
      const warm = performance.now()
      await vm.service.restart({ botId })
      const restartMs = performance.now() - warm
      expect(
        (
          await provider.exec({
            id: vm.service.states().find((state) => state.botId === botId)?.connection?.machineId ?? "missing-test-vm",
            user: "0",
            env: { DISPLAY: ":99", XAUTHORITY: "/var/lib/touri-browser/.Xauthority" },
            command: "/bin/sh",
            args: ["-c", "test ! -e /tmp/.X88-lock && test ! -e /tmp/.X11-unix/X88 && xdotool getdisplaygeometry"],
          })
        ).success,
      ).toBe(true)
      await vm.service.stop({ botId })
      const resumeAt = performance.now()
      const releaseWarm = await vm.service.acquire({ botId })
      const warmMs = performance.now() - resumeAt
      await releaseWarm()
      const persistent = await vm.service.exec({ botId, command: "cat", args: ["/workspace/persisted.txt"] })
      expect(persistent.success && persistent.stdout).toBe("/workspace")
      console.info(
        `[bot VM measurements] first-create=${firstCreateMs.toFixed(0)}ms warm-start=${warmMs.toFixed(0)}ms restart=${restartMs.toFixed(0)}ms cap=2048MiB guest=${
          ram.success
            ? ram.stdout
                .split("\n")
                .filter((line) => /MemTotal|MemAvailable/.test(line))
                .join("; ")
            : "unavailable"
        }`,
      )
    } catch (error) {
      console.error("[bot VM integration failure]", error)
      throw error
    } finally {
      if (mcpChild?.success) mcpChild.kill("SIGKILL")
      await prepared?.release()
      if (botId) await vm.service.destroy({ botId })
      await vm.dispose()
      await stopMcp({ kernel: runtime.kernel })
      runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  180_000,
)
