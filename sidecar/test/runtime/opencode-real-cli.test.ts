import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, ProviderEvent, StartTurnArgs, Thread } from "@touri/contracts"
import { createKernel } from "../../src/kernel"
import { createOpenCodeAdapter } from "../../src/runtime/opencode/adapter"
import { openCodeBinary } from "../../src/runtime/opencode/config"

/** No API key and no model network call: validates the installed server/MCP/session protocol. */
test.skipIf(process.env.TOURI_OPENCODE_REAL !== "1")(
  "real OpenCode 1.18.13 validates isolated config, MCP and session creation without credentials",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-real-opencode-"))
    const runtime = createKernel({ appData: join(root, "data") })
    const binary = openCodeBinary(
      Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    )
    if (!binary.success) throw new Error("Install OpenCode in ~/.opencode/bin first")
    const mcpPath = join(root, "mcp.ts")
    writeFileSync(
      mcpPath,
      `for await (const line of console) { const p = JSON.parse(line); if (p.id === undefined) continue; const result = p.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "touri", version: "1" } } : { tools: [] }; console.log(JSON.stringify({jsonrpc:"2.0",id:p.id,result})); }`,
    )
    const adapter = createOpenCodeAdapter({ kernel: runtime.kernel, command: binary.path, startupMs: 20_000 })
    const events: ProviderEvent[] = []
    const args: StartTurnArgs = {
      bot: {
        id: "real",
        provider: "opencode",
        projectId: null,
        homeDir: join(runtime.kernel.paths.botsDir, "real"),
        access: "read-only",
        approvals: "on-request",
        model: "missing-provider/missing-model",
        reasoningEffort: null,
      } as Bot,
      thread: { id: "real-thread", title: "Teste do protocolo" } as Thread,
      session: null,
      fingerprint: { cwd: root } as StartTurnArgs["fingerprint"],
      input: [{ type: "text", text: "Teste local" }],
      developerInstructions: "Responda em pt-BR",
      handoffPacket: null,
      mcp: { command: process.execPath, args: ["run", mcpPath], env: {} },
      env: { HOME: root, PATH: process.env.PATH ?? "" },
      onEvent: (event) => events.push(event),
      signal: AbortSignal.timeout(25_000),
    }
    try {
      const result = await adapter.startTurn(args)
      expect(events.some((event) => event.type === "session")).toBe(true)
      expect(events.some((event) => event.type === "turn_started")).toBe(true)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error).not.toContain("Configurações externas")
    } finally {
      await adapter.shutdown()
      runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  30_000,
)

test.skipIf(process.env.TOURI_OPENCODE_REAL !== "1")(
  "real OpenCode streams a local fake model, asks permission, executes a tool and resumes the session",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-real-opencode-model-"))
    const runtime = createKernel({ appData: join(root, "data") })
    const binary = openCodeBinary(
      Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    )
    if (!binary.success) throw new Error("Install OpenCode first")
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const body = await req.json()
        requests.push(body)
        const tools = !body.messages.some((message: { role: string }) => message.role === "tool")
        const chunks = [
          {
            choices: [
              {
                index: 0,
                delta: tools
                  ? {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_local",
                          type: "function",
                          function: {
                            name: "bash",
                            arguments: '{"command":"printf opencode-test","description":"Verificar comando local"}',
                          },
                        },
                      ],
                    }
                  : { role: "assistant", content: "Concluído." },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ index: 0, delta: {}, finish_reason: tools ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
          },
        ]
        const text = `${chunks
          .map(
            (chunk) =>
              `data: ${JSON.stringify({ id: "chatcmpl_local", object: "chat.completion.chunk", created: 1, model: "local", ...chunk })}\n\n`,
          )
          .join("")}data: [DONE]\n\n`
        return new Response(text, { headers: { "Content-Type": "text/event-stream" } })
      },
    })
    const mcpPath = join(root, "mcp.ts")
    writeFileSync(
      mcpPath,
      `for await (const line of console) { const p=JSON.parse(line); if(p.id===undefined)continue; console.log(JSON.stringify({jsonrpc:"2.0",id:p.id,result:p.method==="initialize"?{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"touri",version:"1"}}:{tools:[]}})); }`,
    )
    // A test-only model endpoint added to the touri-generated config, never global config.
    const spawn = runtime.kernel.spawnTree
    const kernel = {
      ...runtime.kernel,
      spawnTree: (input: Parameters<typeof spawn>[0]) => {
        if (input.args.includes("serve")) {
          const path = input.env.OPENCODE_CONFIG
          if (!path) throw new Error("Missing private config")
          const config = JSON.parse(readFileSync(path, "utf8"))
          config.provider = {
            "touri-local": {
              npm: "@ai-sdk/openai-compatible",
              name: "Teste local",
              options: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "dummy-local-test-key" },
              models: { local: { name: "DeepSeek simulado", limit: { context: 32000, output: 1000 } } },
            },
          }
          writeFileSync(path, JSON.stringify(config))
        }
        return spawn(input)
      },
    }
    const adapter = createOpenCodeAdapter({ kernel, command: binary.path, startupMs: 20_000 })
    const events: ProviderEvent[] = []
    const args: StartTurnArgs = {
      bot: {
        id: "real",
        provider: "opencode",
        projectId: null,
        homeDir: join(runtime.kernel.paths.botsDir, "real"),
        access: "workspace-write",
        approvals: "on-request",
        model: "touri-local/local",
        reasoningEffort: null,
      } as Bot,
      thread: { id: "thread", title: "Modelo local" } as Thread,
      session: null,
      fingerprint: { cwd: root } as StartTurnArgs["fingerprint"],
      input: [{ type: "text", text: "Execute o comando local" }],
      developerInstructions: "Teste local",
      handoffPacket: null,
      mcp: { command: process.execPath, args: ["run", mcpPath], env: {} },
      env: { HOME: root, PATH: process.env.PATH ?? "" },
      signal: AbortSignal.timeout(50_000),
      onEvent: (event) => {
        events.push(event)
        if (event.type === "approval_request")
          void adapter.answerApproval({ approvalId: event.approvalId, decision: "approved" })
      },
    }
    // Invalid project config proves that on-disk project settings are not parsed.
    writeFileSync(join(root, "opencode.json"), "invalid project configuration")
    try {
      const first = await adapter.startTurn(args)
      expect(first).toMatchObject({ success: true, status: "succeeded" })
      expect(events.filter((event) => event.type === "approval_request")).toHaveLength(1)
      expect(
        events.some((event) => event.type === "item" && event.part.type === "tool_call" && event.part.ok === true),
      ).toBe(true)
      expect(
        events
          .filter((event) => event.type === "text_delta")
          .map((event) => (event.type === "text_delta" ? event.delta : ""))
          .join(""),
      ).toBe("Concluído.")
      if (!first.success) throw new Error(first.error)
      args.session = { externalSessionId: first.externalSessionId } as import("@touri/contracts").ProviderSession
      args.input = [{ type: "text", text: "Continue nesta sessão" }]
      expect(await adapter.startTurn(args)).toMatchObject({ success: true, externalSessionId: first.externalSessionId })
      expect(requests.at(-1)?.messages.some((message) => JSON.stringify(message.content).includes("Concluído."))).toBe(
        true,
      )
    } finally {
      await adapter.shutdown()
      model.stop(true)
      runtime.stop()
      rmSync(root, { recursive: true, force: true })
    }
  },
  60_000,
)
