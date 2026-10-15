import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot } from "@touri/contracts"
import { connectCdpWebSocket } from "../../src/browser/cdp"
import { createKernel } from "../../src/kernel"
import { init as initStore } from "../../src/store"
import { createAppleContainerProvider } from "../../src/vm/apple-container"
import { createVmRuntime } from "../../src/vm/runtime"
import { appleContainerAvailable } from "./integration-available"

test.skipIf(!appleContainerAvailable)(
  "B08 B09 B11 real VM: sandbox, uid separation, authenticated CDP and packet enforcement",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-sec-vm-"))
    const kernel = createKernel({ appData: root })
    await initStore(kernel.kernel)
    const provider = createAppleContainerProvider()
    const runtime = createVmRuntime({ kernel: kernel.kernel, provider })
    kernel.kernel.services.provide("vm.runtime", runtime.service)
    let bot: Bot | undefined
    let release: (() => Promise<void>) | undefined
    try {
      const response = await fetch(`http://127.0.0.1:${kernel.handshake.port}/api/v1/bots`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dev-ui-token",
          "x-touri-client": "sec-vm-integration",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Disposable security VM", provider: "codex", machine: "vm" }),
      })
      bot = ((await response.json()) as { bot: Bot }).bot
      release = await runtime.service.acquire({ botId: bot.id })
      const id = runtime.service.states()[0]?.connection?.machineId
      if (!id) throw new Error("VM missing")
      const endpoint = await runtime.service.browserEndpoint({ botId: bot.id })
      if (!endpoint) throw new Error("browser missing")
      const client = await connectCdpWebSocket({ url: endpoint })
      try {
        expect(((await client.call("Browser.getVersion")) as { product: string }).product).toContain("Chrome")
      } finally {
        await client.close()
      }
      const url = new URL(endpoint)
      expect((await fetch(`http://${url.host}/json/version`)).status).toBe(403)
      expect(
        (await fetch(`http://${url.host}${url.pathname}`, { headers: { Origin: "http://localhost:19324" } })).status,
      ).toBe(403)
      const commands = [
        ["1000", "test ! -r /var/lib/touri-browser/profile/Local\\ State"],
        ["1000", "! DISPLAY=:99 xdotool getdisplaygeometry >/dev/null 2>&1"],
        ["1000", "! python3 -c \"import socket; socket.create_connection(('127.0.0.1',5900),.2)\" >/dev/null 2>&1"],
        ["1000", "! curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null 2>&1"],
        ["1000", "! curl -fsS --max-time 1 http://169.254.169.254/ >/dev/null 2>&1"],
        ["1000", "! nft list table inet touri >/dev/null 2>&1"],
        ["1000", "curl -fsS --max-time 15 https://example.com >/dev/null"],
        [
          "1000",
          "umask 077; printf synthetic > /workspace/.touri/run/credential-test; printf synthetic > /workspace/.home/.codex/auth.json",
        ],
        ["1001", "test ! -r /workspace/.touri/run/credential-test && test ! -r /workspace/.home/.codex/auth.json"],
      ]
      for (const [user, command] of commands) {
        const result = await provider.exec({
          id,
          user: user ?? "1000",
          command: "sh",
          args: ["-c", command ?? "false"],
        })
        expect(result.success).toBe(true)
      }
      const status = await provider.exec({
        id,
        command: "python3",
        args: [
          "-c",
          `import pathlib
renderers=[]
for path in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 try:
  args=path.read_bytes()
  if b'--type=renderer' in args and (path.parent/'comm').read_text().strip()=='chromium':
   status=(path.parent/'status').read_text()
   assert '--no-sandbox' not in args.decode('utf-8','replace')
   assert 'Seccomp:\\t2' in status
   assert 'Uid:\\t1001\\t' in status
   renderers.append(path)
 except (FileNotFoundError,ProcessLookupError,PermissionError): pass
assert renderers,'sandboxed renderer missing'`,
        ],
      })
      expect(status.success).toBe(true)
    } finally {
      await release?.()
      if (bot) await runtime.service.destroy({ botId: bot.id, deleteVolumes: true })
      await runtime.dispose()
      await provider.stopBuilder?.()
      kernel.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  180000,
)
