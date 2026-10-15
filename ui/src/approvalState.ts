import type { ApprovalPart, Message, NotificationRecord } from "@touri/contracts"

export const resolvedApprovalLabel = (decision: ApprovalPart["decision"]): string =>
  decision === "approved" ? "Aprovado por você" : decision === "expired" ? "Aprovação expirada" : "Negado por você"

export const isResolvedNotification = (item: NotificationRecord): boolean =>
  item.resolvedAt !== null ||
  (item.kind === "approval" && ["allow", "deny", "expired", "dismissed"].includes(item.resolution ?? ""))

export const reconcileApprovalMessages = (messages: Message[], notifications: NotificationRecord[]): Message[] =>
  messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "approval") return part
      const notice = notifications.find(
        (item) => item.kind === "approval" && item.threadId === message.threadId && item.requestId === part.approvalId,
      )
      if (!notice || !["allow", "deny", "expired"].includes(notice.resolution ?? "")) return part
      return {
        ...part,
        decision:
          part.decision !== "pending"
            ? part.decision
            : notice.resolution === "allow"
              ? "approved"
              : notice.resolution === "expired"
                ? "expired"
                : "denied",
        ...(notice.resolvedAt !== null ? { resolvedAt: part.resolvedAt ?? notice.resolvedAt } : {}),
      } as ApprovalPart
    }),
  }))

export const reconcileApprovalNotifications = (
  items: NotificationRecord[],
  messages: Message[],
): NotificationRecord[] =>
  items.map((item) => {
    if (item.kind !== "approval" || item.resolvedAt !== null) return item
    const message = messages.find(
      (message) =>
        message.threadId === item.threadId &&
        message.parts.some(
          (part) => part.type === "approval" && part.approvalId === item.requestId && part.decision !== "pending",
        ),
    )
    const part = message?.parts.find((part) => part.type === "approval" && part.approvalId === item.requestId)
    if (!message || part?.type !== "approval" || part.decision === "pending") return item
    return {
      ...item,
      resolvedAt: part.resolvedAt ?? null,
      resolution: part.decision === "approved" ? "allow" : part.decision === "expired" ? "expired" : "deny",
    }
  })
