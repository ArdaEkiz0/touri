import type { Kernel, ToolHandler } from "@touri/contracts"

type NotifyArgs = { title: string; body: string }

export const createNotifyUserHandler = ({ kernel }: { kernel: Kernel }): ToolHandler => {
  const lastSentAt = new Map<string, number>()
  return async ({ ctx, args }) => {
    const input = args as NotifyArgs
    const now = Date.now()
    const previous = lastSentAt.get(ctx.botId)
    if (previous !== undefined && now - previous < 30_000)
      return { success: false, errorCode: "RATE_LIMITED", error: "Notifications are limited to one every 30 seconds" }

    const host = await kernel.callHost("notify", {
      title: kernel.redact(input.title),
      body: kernel.redact(input.body),
      threadId: ctx.threadId,
    })
    if (!host.success) return { success: false, errorCode: host.errorCode, error: kernel.redact(host.error) }
    lastSentAt.set(ctx.botId, now)
    return { success: true, content: [{ type: "text", text: "Notification sent" }] }
  }
}
