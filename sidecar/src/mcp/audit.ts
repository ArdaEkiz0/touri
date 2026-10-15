import type { Database } from "bun:sqlite"
import type { Id, Kernel, ToolResult } from "@touri/contracts"
import { redactMcpValue } from "./redact"

export const auditToolCall = ({
  kernel,
  runId,
  threadId,
  botId,
  tool,
  args,
  result,
  durationMs,
}: {
  kernel: Kernel
  runId: Id | null
  threadId: Id
  botId: Id
  tool: string
  args: unknown
  result: ToolResult
  durationMs: number
}): void => {
  const database = kernel.db as Database
  const serializedArgs = JSON.stringify(redactMcpValue(args, kernel.redact)) ?? "null"
  try {
    database
      .query(
        `INSERT INTO tool_calls
          (id, run_id, thread_id, bot_id, tool, args_json, ok, error_code, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        kernel.newId(),
        runId,
        threadId,
        botId,
        tool,
        serializedArgs,
        result.success ? 1 : 0,
        result.success ? null : result.errorCode,
        durationMs,
        Date.now(),
      )
  } catch {
    kernel.log({ level: "warn", module: "mcp", msg: "Unable to write MCP tool audit row" })
  }
}
