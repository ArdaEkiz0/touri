import type { Database } from "bun:sqlite"
import type { Kernel, Message, ToolHandler } from "@touri/contracts"
import { consentToPrivateHistory, groupHistoryThread } from "../../groups/privacy"

type ReadArgs = { threadId: string; aroundMessageId?: string; limit?: number }
type MessageRow = {
  id: string
  thread_id: string
  parent_id: string | null
  role: Message["role"]
  kind: Message["kind"]
  status: Message["status"]
  run_id: string | null
  text: string
  parts_json: string
  sender_json: string | null
  source: Message["source"]
  created_at: number
  updated_at: number
}

const parseArgs = (args: unknown): ReadArgs => args as ReadArgs

const parseJson = (value: string | null, fallback: unknown): unknown => {
  if (value === null) return fallback
  try {
    return JSON.parse(value) as unknown
  } catch {
    return fallback
  }
}

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  threadId: row.thread_id,
  parentId: row.parent_id,
  role: row.role,
  kind: row.kind,
  status: row.status,
  runId: row.run_id,
  text: row.text,
  parts: parseJson(row.parts_json, []) as Message["parts"],
  sender: parseJson(row.sender_json, null) as Message["sender"],
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const sliceAround = ({
  messages,
  aroundMessageId,
  limit,
}: {
  messages: Array<Message>
  aroundMessageId?: string
  limit: number
}): Array<Message> => {
  if (messages.length <= limit) return messages
  if (!aroundMessageId) return messages.slice(messages.length - limit)
  const index = messages.findIndex((message) => message.id === aroundMessageId)
  if (index < 0) return messages.slice(messages.length - limit)
  const before = Math.floor(limit / 2)
  const start = Math.max(0, Math.min(index - before, messages.length - limit))
  return messages.slice(start, start + limit)
}

export const createHistoryReadHandler =
  ({ kernel }: { kernel: Kernel }): ToolHandler =>
  async ({ ctx, args }) => {
    const store = kernel.services.use("store.api")
    if (!store) return { success: false, errorCode: "STORE_UNAVAILABLE", error: "Conversation store is unavailable" }
    const input = parseArgs(args)
    const callerThread = store.getThread({ threadId: ctx.threadId })
    const groupThread = callerThread ? groupHistoryThread(callerThread) : null
    const thread = store.getThread({ threadId: input.threadId })
    const shared = groupThread !== null && input.threadId === groupThread
    if (!thread || (!shared && thread.botId !== ctx.botId))
      return { success: false, errorCode: "THREAD_NOT_FOUND", error: "Thread not found" }
    if (
      groupThread &&
      !shared &&
      input.threadId !== ctx.threadId &&
      !(await consentToPrivateHistory(kernel, ctx, input.threadId))
    )
      return {
        success: false,
        errorCode: "PRIVATE_HISTORY_CONSENT_REQUIRED",
        error: "O histórico privado exige aprovação humana para uso no grupo.",
      }

    const limit = input.limit ?? 30
    const database = kernel.db as Database
    let messages: Array<Message> = []
    try {
      const rows = database
        .query(
          `SELECT id, thread_id, parent_id, role, kind, status, run_id, text, parts_json, sender_json, source,
                created_at, updated_at
           FROM messages
          WHERE thread_id = ?
          ORDER BY created_at ASC, id ASC`,
        )
        .all(input.threadId) as Array<MessageRow>
      messages = rows.map(toMessage)
      if (messages.length === 0) {
        messages =
          input.aroundMessageId === undefined
            ? store.activePath({ threadId: input.threadId })
            : store.activePath({ threadId: input.threadId, leafId: input.aroundMessageId })
      }
    } catch {
      messages =
        input.aroundMessageId === undefined
          ? store.activePath({ threadId: input.threadId })
          : store.activePath({ threadId: input.threadId, leafId: input.aroundMessageId })
    }

    const selected =
      input.aroundMessageId === undefined
        ? sliceAround({ messages, limit })
        : sliceAround({ messages, aroundMessageId: input.aroundMessageId, limit })
    return {
      success: true,
      content: [{ type: "text", text: JSON.stringify({ threadId: input.threadId, messages: selected }) }],
    }
  }
