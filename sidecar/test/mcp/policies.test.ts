import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ApprovalPart, Bot, McpServer, ToolContext, ToolRegistration } from "@touri/contracts"
import { createApprovalBridge } from "../../src/approvals/bridge"
import { createStandingGrantStore } from "../../src/approvals/grants"
import { delegationCeiling, setDelegation } from "../../src/groups/security"
import { createKernel } from "../../src/kernel"
import { init as initMcp, stop as stopMcp } from "../../src/mcp"
import { attachedServers } from "../../src/mcp/attached"
import { forwardedToolName, forwardTool } from "../../src/mcp/forward"
import { createToolRouter } from "../../src/mcp/router"
import { init as initStore } from "../../src/store"

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

const fixture = async (timeoutMs = 1000) => {
  const root = mkdtempSync(join(tmpdir(), "touri-policies-"))
  const runtime = createKernel({ appData: root })
  await initStore(runtime.kernel)
  await initMcp(runtime.kernel)
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${runtime.handshake.port}/api/v1${path}`, {
      method,
      headers: {
        Authorization: "Bearer dev-ui-token",
        "x-touri-client": "policy-test",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, value: await response.json() }
  }
  const bot = (await request("POST", "/bots", { name: "policy-bot", provider: "claude", access: "full" })).value
    .bot as Bot
  const cards: ApprovalPart[] = []
  const bridge = createApprovalBridge({
    kernel: runtime.kernel,
    timeoutMs,
    onCard: (_, part) => {
      cards.push(structuredClone(part))
      return true
    },
  })
  runtime.kernel.services.provide("approvals.present", bridge.present)
  const calls: string[] = []
  let onHandshake: (() => Promise<void>) | undefined
  const remote = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== "POST") return new Response(null, { status: 405 })
      const q = (await request.json()) as {
        id?: number
        method: string
        params: { protocolVersion?: string; name?: string }
      }
      if (q.id === undefined) return new Response(null, { status: 202 })
      let result: unknown
      if (q.method === "initialize") {
        await onHandshake?.()
        result = {
          protocolVersion: q.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "policy-fixture", version: "1" },
        }
      } else if (q.method === "tools/list")
        result = {
          tools: [
            {
              name: "inspect",
              description: "Inspect fixture",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true },
            },
            { name: "change", description: "Change fixture", inputSchema: { type: "object" } },
          ],
        }
      else {
        calls.push(q.params.name ?? "unknown")
        result = { content: [{ type: "text", text: "executed" }] }
      }
      return Response.json({ jsonrpc: "2.0", id: q.id, result })
    },
  })
  const config: McpServer = {
    name: "fixture",
    transport: "http",
    url: `http://127.0.0.1:${remote.port}/mcp`,
    tools: [],
  }
  expect((await request("PUT", `/bots/${bot.id}/mcp/fixture`, config)).status).toBe(200)
  const ctx: ToolContext = {
    botId: bot.id,
    threadId: bot.mainThreadId ?? "",
    runId: null,
    projectId: null,
    cwd: root,
    signal: new AbortController().signal,
  }
  const call = (name: string, context = ctx) => {
    const server = attachedServers(runtime.kernel, bot.id)[0]
    const tool = server?.tools.find((tool) => tool.name === name)
    if (!server || !tool) throw new Error("Missing fixture tool")
    return forwardTool({ kernel: runtime.kernel, ctx: context, server, tool, args: {} })
  }
  cleanup.push(async () => {
    bridge.dispose()
    remote.stop(true)
    await stopMcp({ kernel: runtime.kernel })
    runtime.stop()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    runtime,
    request,
    bot,
    cards,
    bridge,
    calls,
    ctx,
    call,
    config,
    onHandshake: (callback: () => Promise<void>) => {
      onHandshake = callback
    },
  }
}

test("MCP discovery classifies tools; writes wait for approval, deny never forwards, reads forward", async () => {
  const f = await fixture()
  expect(
    attachedServers(f.runtime.kernel, f.bot.id)[0]?.tools.map(({ classification, policy }) => [classification, policy]),
  ).toEqual([
    ["reads", "always_allow"],
    ["writes", "needs_approval"],
  ])
  expect((await f.call("inspect")).success).toBe(true)
  const write = f.call("change")
  expect(f.calls).toEqual(["inspect"])
  const card = f.cards[0]
  if (!card) throw new Error("Missing card")
  await f.bridge.approve({ approvalId: card.approvalId, decision: "denied" })
  expect(await write).toMatchObject({ success: false, error: "Negado pelo usuário." })
  expect(f.calls).toEqual(["inspect"])
  expect(f.cards.at(-1)?.decision).toBe("denied")
})

test("standing MCP grants survive a new bridge, are isolated by bot/server/tool and revocable", async () => {
  const f = await fixture()
  const pending = f.call("change")
  const card = f.cards[0]
  if (!card) throw new Error("Missing card")
  await f.bridge.approve({ approvalId: card.approvalId, decision: "approved", standing: true })
  expect(await pending).toMatchObject({
    success: true,
    content: [
      { type: "text", text: "Aprovado: sempre para esta ferramenta neste bot." },
      { type: "text", text: "executed" },
    ],
  })
  const second = createApprovalBridge({
    kernel: f.runtime.kernel,
    onCard: () => {
      throw new Error("Standing grant should skip card")
    },
  })
  f.runtime.kernel.services.provide("approvals.present", second.present)
  expect(await f.call("change")).toMatchObject({
    success: true,
    content: [
      { type: "text", text: "Aprovado automaticamente pela permissão permanente desta ferramenta neste bot." },
      { type: "text", text: "executed" },
    ],
  })
  const store = createStandingGrantStore(f.runtime.kernel)
  expect(store.has("another-bot", { source: "mcp", server: "fixture", tool: "change" })).toBe(false)
  expect(store.has(f.bot.id, { source: "mcp", server: "another-server", tool: "change" })).toBe(false)
  expect(store.has(f.bot.id, { source: "claude", tool: "change" })).toBe(false)
  const grant = (await f.request("GET", `/bots/${f.bot.id}/grants`)).value.grants[0]
  await f.request("DELETE", `/bots/${f.bot.id}/grants/${grant.id}`)
  expect(store.list(f.bot.id)).toEqual([])
  f.runtime.kernel.services.provide("approvals.present", f.bridge.present)
  const third = f.call("change")
  const next = f.cards.at(-1)
  if (!next) throw new Error("Missing card")
  await f.bridge.approve({ approvalId: next.approvalId, decision: "approved" })
  expect(await third).toMatchObject({
    success: true,
    content: [
      { type: "text", text: "Aprovado pelo usuário (uma vez)." },
      { type: "text", text: "executed" },
    ],
  })
  expect(store.list(f.bot.id)).toEqual([])
})

test("blocked policy wins over grants; changes during approval cannot forward; read-only denies writes", async () => {
  const f = await fixture()
  const grants = createStandingGrantStore(f.runtime.kernel)
  grants.add(f.bot.id, { source: "mcp", server: "fixture", tool: "change" })
  expect(
    (
      await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
        classification: "writes",
        policy: "blocked",
      })
    ).status,
  ).toBe(200)
  expect((await f.call("change")).success).toBe(false)
  expect(grants.list(f.bot.id)).toEqual([])
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
    classification: "writes",
    policy: "needs_approval",
  })
  const waiting = f.call("change")
  const card = f.cards[0]
  if (!card) throw new Error("Missing card")
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
    classification: "writes",
    policy: "blocked",
  })
  expect((await f.bridge.approve({ approvalId: card.approvalId, decision: "approved", standing: true })).success).toBe(
    false,
  )
  expect((await waiting).success).toBe(false)
  expect(grants.list(f.bot.id)).toEqual([])
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
    classification: "writes",
    policy: "always_allow",
  })
  await f.request("PATCH", `/bots/${f.bot.id}`, { access: "read-only" })
  expect((await f.call("change")).success).toBe(false)
  expect(f.calls).toEqual([])
})

test("gateway advertises forwarded schemas and enforces policy before the external call", async () => {
  const f = await fixture()
  const router = createToolRouter({ kernel: f.runtime.kernel, registrations: new Map() })
  const caller = { ...f.ctx, provider: "claude" as const, browserEnabled: false, computerUse: false }
  const name = forwardedToolName("fixture", "inspect")
  expect(router.list({ caller }).find((tool) => tool.name === name)?.inputSchema).toEqual({ type: "object" })
  expect((await router.call({ caller, name, args: {}, signal: f.ctx.signal, id: 1 })).success).toBe(true)
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/inspect`, {
    classification: "reads",
    policy: "blocked",
  })
  expect(router.list({ caller }).some((tool) => tool.name === name)).toBe(false)
  expect((await router.call({ caller, name, args: {}, signal: f.ctx.signal, id: 2 })).success).toBe(false)
  expect(f.calls).toEqual(["inspect"])
})

test("cancellation, expiry and settlement deny without forwarding or late standing grants", async () => {
  const f = await fixture(15)
  const abort = new AbortController()
  const waiting = f.call("change", { ...f.ctx, signal: abort.signal })
  const card = f.cards[0]
  if (!card) throw new Error("Missing card")
  abort.abort()
  expect((await waiting).success).toBe(false)
  expect((await f.bridge.approve({ approvalId: card.approvalId, decision: "approved", standing: true })).success).toBe(
    false,
  )
  expect((await f.call("change")).success).toBe(false)
  expect(f.cards.at(-1)?.decision).toBe("expired")
  const settled = f.call("change")
  const last = f.cards.at(-1)
  if (!last) throw new Error("Missing card")
  f.bridge.settle({ approvalId: last.approvalId, decision: "denied" })
  expect((await settled).success).toBe(false)
  expect(f.calls).toEqual([])
  expect(createStandingGrantStore(f.runtime.kernel).list(f.bot.id)).toEqual([])
})

test("reconnecting the same server preserves policies; disconnect clears server grants", async () => {
  const f = await fixture()
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, { classification: "reads", policy: "blocked" })
  await f.request("PUT", `/bots/${f.bot.id}/mcp/fixture`, f.config)
  expect(attachedServers(f.runtime.kernel, f.bot.id)[0]?.tools.find((tool) => tool.name === "change")?.policy).toBe(
    "blocked",
  )
  createStandingGrantStore(f.runtime.kernel).add(f.bot.id, { source: "mcp", server: "fixture", tool: "inspect" })
  await f.request("DELETE", `/bots/${f.bot.id}/mcp/fixture`)
  expect(createStandingGrantStore(f.runtime.kernel).list(f.bot.id)).toEqual([])
})

test("policy is checked again after the remote handshake before forwarding", async () => {
  const f = await fixture()
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
    classification: "writes",
    policy: "always_allow",
  })
  let connected = false
  let resume = () => {}
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  f.onHandshake(async () => {
    connected = true
    await gate
  })
  const pending = f.call("change")
  try {
    while (!connected) await Bun.sleep(5)
    await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
      classification: "writes",
      policy: "blocked",
    })
  } finally {
    resume()
  }
  expect((await pending).success).toBe(false)
  expect(f.calls).toEqual([])
})

test("an approval for a replaced connection cannot grant or forward to the replacement", async () => {
  const f = await fixture()
  const other = await fixture()
  const pending = f.call("change")
  const card = f.cards[0]
  if (!card) throw new Error("Missing card")
  await f.request("PUT", `/bots/${f.bot.id}/mcp/fixture`, other.config)
  expect((await f.bridge.approve({ approvalId: card.approvalId, decision: "approved", standing: true })).success).toBe(
    false,
  )
  expect((await pending).success).toBe(false)
  expect(createStandingGrantStore(f.runtime.kernel).list(f.bot.id)).toEqual([])
  expect(other.calls).toEqual([])
})

test("Claude questions cannot create or use a standing grant; run settlement and disposal close cards", async () => {
  const f = await fixture()
  const grants = createStandingGrantStore(f.runtime.kernel)
  const scope = { source: "claude" as const, tool: "AskUserQuestion" }
  grants.add(f.bot.id, scope)
  const question = f.bridge.present({
    ctx: { ...f.ctx, runId: "run-a" },
    scope,
    toolName: scope.tool,
    input: { questions: [{ question: "Qual arquivo?" }] },
  })
  const card = f.cards[0]
  if (!card) throw new Error("Missing question card")
  expect(card.allowStanding).toBe(false)
  grants.revoke(f.bot.id, grants.list(f.bot.id)[0]?.id ?? "")
  await f.bridge.approve({ approvalId: card.approvalId, decision: "approved", standing: true })
  expect(await question).toMatchObject({ success: true, behavior: "allow" })
  expect(grants.list(f.bot.id)).toEqual([])
  const waiting = f.bridge.present({
    ctx: { ...f.ctx, runId: "run-b" },
    scope: { source: "claude", tool: "Bash" },
    toolName: "Bash",
    input: {},
  })
  f.bridge.cancelRun("run-b")
  expect(await waiting).toMatchObject({ success: true, behavior: "deny" })
  expect(f.cards.at(-1)?.decision).toBe("denied")
  f.bridge.dispose()
  expect(await f.bridge.present({ ctx: f.ctx, scope, toolName: scope.tool, input: {} })).toMatchObject({
    success: false,
  })
})

test("a failed card cannot leave a pending approval or grant", async () => {
  const f = await fixture()
  const bridge = createApprovalBridge({
    kernel: f.runtime.kernel,
    onCard: () => {
      throw new Error("Unavailable conversation")
    },
  })
  expect(
    await bridge.present({ ctx: f.ctx, scope: { source: "claude", tool: "Bash" }, toolName: "Bash", input: {} }),
  ).toMatchObject({ success: true, behavior: "deny" })
  expect(createStandingGrantStore(f.runtime.kernel).list(f.bot.id)).toEqual([])
  bridge.dispose()
})

test("policy routes reject non-string choices and grants cannot be revoked through another bot", async () => {
  const f = await fixture()
  expect(
    (
      await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
        classification: ["reads"],
        policy: "always_allow",
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
        classification: "writes",
        policy: ["blocked"],
      })
    ).status,
  ).toBe(400)
  const grants = createStandingGrantStore(f.runtime.kernel)
  grants.add(f.bot.id, { source: "mcp", server: "fixture", tool: "change" })
  expect((await f.request("DELETE", `/bots/missing/grants/${grants.list(f.bot.id)[0]?.id}`)).status).toBe(404)
  expect(grants.list(f.bot.id)).toHaveLength(1)
})

const delegationFixture = async (approvals: "never" | "on-request" = "never") => {
  const f = await fixture()
  expect((await f.request("PATCH", `/bots/${f.bot.id}`, { approvals, browserEnabled: true })).status).toBe(200)
  const ran: string[] = []
  const handler = (name: string) => async () => {
    ran.push(name)
    return { success: true as const, content: [{ type: "text" as const, text: name }] }
  }
  const registrations = new Map<string, ToolRegistration>(
    ["browser_navigate", "secret_list", "env_write_file"].map((name) => [
      name,
      { name, group: name === "browser_navigate" ? ("browser" as const) : ("secret" as const), handler: handler(name) },
    ]),
  )
  const router = createToolRouter({ kernel: f.runtime.kernel, registrations })
  const caller = {
    botId: f.bot.id,
    threadId: f.bot.mainThreadId ?? "",
    projectId: "project-1",
    cwd: f.ctx.cwd,
    provider: "claude" as const,
    browserEnabled: true,
    computerUse: false,
  }
  const target = (): Bot => ({
    ...f.bot,
    approvals,
    browserEnabled: true,
    mcpServers: attachedServers(f.runtime.kernel, f.bot.id),
  })
  const delegate = (callerBot: Bot, secrets: boolean) =>
    setDelegation(f.runtime.kernel, caller.threadId, {
      ceiling: delegationCeiling(callerBot, target()),
      caller: { id: callerBot.id, name: callerBot.name },
      groupThreadId: "group-thread",
      secrets,
    })
  const navigate = () =>
    router.call({
      id: 1,
      name: "browser_navigate",
      args: { tabId: "t_00000000000000000000000000", url: "https://example.com" },
      caller: { ...caller, projectId: null },
      signal: new AbortController().signal,
    })
  return { ...f, router, caller, ran, target, delegate, navigate }
}

test("B05 ceiling: delegated runs lose browser, secrets and forwarded MCP the caller does not hold", async () => {
  const f = await delegationFixture()
  const names = () => f.router.list({ caller: f.caller }).map((tool) => tool.name)
  expect(names()).toEqual(expect.arrayContaining(["browser_navigate", "secret_list"]))
  expect(names().some((name) => name.startsWith("integration_"))).toBe(true)
  f.delegate({ ...f.target(), browserEnabled: false, mcpServers: [] }, false)
  expect(names()).not.toContain("browser_navigate")
  expect(names()).not.toContain("secret_list")
  expect(names().some((name) => name.startsWith("integration_"))).toBe(false)
  expect(await f.navigate()).toMatchObject({ success: false })
  const forwarded = f.router.call({
    id: 2,
    name: forwardedToolName("fixture", "inspect"),
    args: {},
    caller: f.caller,
    signal: new AbortController().signal,
  })
  expect(await forwarded).toMatchObject({ success: false, errorCode: "TOOL_NOT_FOUND" })
  expect(f.calls).toEqual([])
  expect(f.ran).toEqual([])
})

test("B05 ceiling: a read-only caller ceiling denies mutating tools of a full-access target", async () => {
  const f = await delegationFixture()
  f.delegate({ ...f.target(), access: "read-only" }, true)
  expect(await f.navigate()).toMatchObject({ success: false, errorCode: "DENIED" })
  expect(f.ran).toEqual([])
})

test("B05 ceiling: a VM caller reaching a local never-approve full-access bot needs a card per mutating tool", async () => {
  const f = await delegationFixture("never")
  const direct = await f.navigate()
  expect(direct).toMatchObject({ success: true })
  expect(f.cards).toHaveLength(0)
  f.ran.length = 0
  f.delegate({ ...f.target(), machine: "vm", access: "full", approvals: "never" }, true)
  const pending = f.navigate()
  await Bun.sleep(30)
  expect(f.ran).toEqual([])
  const card = f.cards.at(-1)
  if (!card) throw new Error("Missing approval card for the delegated host action")
  await f.bridge.approve({ approvalId: card.approvalId, decision: "denied" })
  expect(await pending).toMatchObject({ success: false })
  expect(f.ran).toEqual([])
})

test("B05 ceiling: same-level delegation leaves tools and policies unchanged", async () => {
  const f = await delegationFixture("never")
  f.delegate(f.target(), true)
  const names = f.router.list({ caller: f.caller }).map((tool) => tool.name)
  expect(names).toEqual(expect.arrayContaining(["browser_navigate", "secret_list"]))
  expect(names.some((name) => name.startsWith("integration_"))).toBe(true)
  expect(await f.navigate()).toMatchObject({ success: true })
  expect(f.cards).toHaveLength(0)
})

test("R13-B09: guest-to-host delegation prompts per action even for always_allow tools", async () => {
  const f = await fixture()
  await f.request("PATCH", `/bots/${f.bot.id}/mcp/fixture/tools/change`, {
    classification: "writes",
    policy: "always_allow",
  })
  const caller: Bot = { ...f.bot, machine: "vm", mcpServers: attachedServers(f.runtime.kernel, f.bot.id) }
  setDelegation(f.runtime.kernel, f.ctx.threadId, {
    ceiling: caller,
    caller: { id: caller.id, name: "guest" },
    groupThreadId: "group",
    secrets: false,
  })
  const waiting = f.call("change")
  await Bun.sleep(30)
  expect(f.calls).toEqual([])
  const card = f.cards[0]
  if (!card) throw new Error("Missing approval card")
  await f.bridge.approve({ approvalId: card.approvalId, decision: "approved" })
  expect((await waiting).success).toBe(true)
  expect(f.calls).toEqual(["change"])
})
