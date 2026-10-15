import type { Kernel, Thread, ToolContext } from "@touri/contracts"

// Participant sessions persist beyond one delegation. Keep their privacy boundary even
// when no group turn is active; a stale MCP connection must not regain private history.
export const groupHistoryThread = (thread: Thread): string | null =>
  thread.groupId ? (thread.groupThreadId ?? thread.id) : null

export const consentToPrivateHistory = async (kernel: Kernel, ctx: ToolContext, threadId: string): Promise<boolean> => {
  const present = kernel.services.use("approvals.present")
  if (!present || ctx.signal.aborted) return false
  const result = await present({
    ctx,
    scope: { source: "mcp", tool: "group_private_history" },
    toolName: "Consultar e compartilhar histórico privado no grupo",
    input: { threadId, aviso: "O conteúdo desta conversa privada poderá ser compartilhado com os membros do grupo." },
    allowStanding: false,
    isCurrent: () =>
      !ctx.signal.aborted && kernel.services.use("store.api")?.getThread({ threadId })?.botId === ctx.botId,
  })
  return (
    result.success &&
    result.behavior === "allow" &&
    !ctx.signal.aborted &&
    kernel.services.use("store.api")?.getThread({ threadId })?.botId === ctx.botId
  )
}
