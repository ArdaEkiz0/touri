import type { Id, Message } from "@touri/contracts"

export type ApprovalTarget = { threadId: Id; approvalId: Id }
export type ApprovalFocus = { approvalId: Id; request: number }

export const pendingApprovalTargets = (messages: Array<Message>): Array<ApprovalTarget> =>
  messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "approval" && part.decision === "pending"
        ? [{ threadId: message.threadId, approvalId: part.approvalId }]
        : [],
    ),
  )
