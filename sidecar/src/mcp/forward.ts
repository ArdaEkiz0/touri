import { createHash } from "node:crypto"
import type { Bot, Kernel, McpServer, McpTool, ToolContext, ToolResult } from "@touri/contracts"
import { withApprovalOutcome } from "../approvals/outcome"
import { delegatedBot, getDelegation } from "../groups/security"
import { attachedServers, normalizedTool, withAttachedClient } from "./attached"

// Deterministic, collision resistant and within the providers' tool-name limits.
export const forwardedToolName = (server: string, tool: string): string =>
  `integration_${createHash("sha256")
    .update(JSON.stringify([server, tool]))
    .digest("hex")
    .slice(0, 32)}`

const scopedServers = (kernel: Kernel, botId: string, threadId?: string): McpServer[] => {
  const servers = attachedServers(kernel, botId)
  if (!threadId || !getDelegation(kernel, threadId)) return servers
  const bot = kernel.services.use("store.api")?.getBot({ botId })
  if (!bot) return []
  return delegatedBot(kernel, threadId, { ...bot, mcpServers: servers }).mcpServers ?? []
}

export const attachedTools = (kernel: Kernel, botId: string, threadId?: string) =>
  scopedServers(kernel, botId, threadId).flatMap((server) =>
    server.tools.map((tool) => ({
      server,
      tool: normalizedTool(tool),
      name: forwardedToolName(server.name, tool.name),
    })),
  )

export const forwardTool = async ({
  kernel,
  ctx,
  server,
  tool,
  args,
}: {
  kernel: Kernel
  ctx: ToolContext
  server: McpServer
  tool: McpTool
  args: unknown
}): Promise<ToolResult> => {
  const denied = (message: string): ToolResult => ({ success: false, errorCode: "DENIED", error: message })
  const current = () =>
    attachedTools(kernel, ctx.botId, ctx.threadId).find(
      (value) => value.server.name === server.name && value.tool.name === tool.name,
    )
  const initial = current()
  const effectiveBot = (): Bot | null => {
    const stored = kernel.services.use("store.api")?.getBot({ botId: ctx.botId })
    return stored ? delegatedBot(kernel, ctx.threadId, stored) : null
  }
  const bot = effectiveBot()
  if (!bot || !initial) return denied("Esta ferramenta não está conectada ao bot.")
  const machine = bot.machine
  if (!args || typeof args !== "object" || Array.isArray(args))
    return { success: false, errorCode: "INVALID_ARGS", error: "Os argumentos MCP devem ser um objeto." }
  const configuration = (value: NonNullable<ReturnType<typeof current>>) =>
    JSON.stringify({ ...value.server, tools: [value.tool] })
  const isCurrent = () => {
    const latest = current()
    const latestBot = effectiveBot()
    return (
      !ctx.signal.aborted &&
      !!latest &&
      !!latestBot &&
      latestBot.machine === machine &&
      latest.tool.policy !== "blocked" &&
      !(latest.tool.classification === "writes" && latestBot.access === "read-only") &&
      configuration(latest) === configuration(initial)
    )
  }
  if (initial.tool.policy === "blocked") return denied("Esta ferramenta está bloqueada para este bot.")
  if (initial.tool.classification === "writes" && bot.access === "read-only")
    return denied("Um bot somente leitura não pode executar ferramentas de escrita.")
  let approvalMessage: string | undefined
  const delegation = getDelegation(kernel, ctx.threadId)
  const storedBot = kernel.services.use("store.api")?.getBot({ botId: ctx.botId })
  const guestToHost = !!delegation && delegation.ceiling.machine !== "local" && storedBot?.machine === "local"
  const forced =
    !!delegation && bot.approvals === "on-request" && (guestToHost || initial.tool.classification !== "reads")
  if (initial.tool.policy === "needs_approval" || forced) {
    const present = kernel.services.use("approvals.present")
    if (!present) return denied("A ponte de aprovação está indisponível.")
    const approved = await present({
      ctx,
      scope: { source: "mcp", server: server.name, tool: tool.name },
      toolName: `${server.name} · ${tool.name}`,
      input: args,
      ...(forced ? { allowStanding: false } : {}),
      isCurrent,
    })
    if (!approved.success) return denied(approved.error)
    if (approved.behavior !== "allow") return denied(approved.message ?? "A ferramenta não foi aprovada.")
    approvalMessage = approved.message
  }
  const latest = current()
  const latestBot = effectiveBot()
  if (!latest || !latestBot || !isCurrent())
    return withApprovalOutcome(denied("A autorização MCP mudou. Solicite a ferramenta novamente."), approvalMessage)
  try {
    return withApprovalOutcome(
      await withAttachedClient(
        kernel,
        latestBot,
        latest.server,
        async (client) => {
          ctx.signal.throwIfAborted()
          // Connecting may await a process or a remote handshake; check again at the egress.
          if (!isCurrent()) return denied("A autorização MCP mudou. Solicite a ferramenta novamente.")
          const result = await client.callTool(
            { name: tool.name, arguments: args as Record<string, unknown> },
            undefined,
            { signal: ctx.signal },
          )
          const content = result.content as NonNullable<ToolResult["content"]>
          return result.isError
            ? { success: false, errorCode: "MCP_TOOL_ERROR", error: "O servidor MCP retornou um erro.", content }
            : {
                success: true,
                content,
                ...(result.structuredContent === undefined ? {} : { structured: result.structuredContent }),
              }
        },
        60_000,
        ctx.signal,
      ),
      approvalMessage,
    )
  } catch (error) {
    return withApprovalOutcome(
      {
        success: false,
        errorCode: "MCP_UNAVAILABLE",
        error: kernel.redact(error instanceof Error ? error.message : "Servidor MCP indisponível."),
      },
      approvalMessage,
    )
  }
}
