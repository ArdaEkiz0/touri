import type { Database } from "bun:sqlite"
import type { MessagePart, StoreApi, ToolResolution } from "@touri/contracts"
import { bounded } from "./utils"

type ToolPart = Extract<MessagePart, { callId: string }>
type ResolutionRow = {
  run_id: string
  request_message_id: string | null
  part_json: string
  resolution: ToolResolution
}

const describe = (row: ResolutionRow): string => {
  const part = JSON.parse(row.part_json) as ToolPart
  const name = part.type === "tool_call" ? part.tool : part.type === "command" ? part.command : part.paths.join(", ")
  const detail = part.type === "tool_call" ? part.outputJson : part.type === "command" ? part.outputTail : part.diff
  const result =
    part.type === "tool_call"
      ? part.ok
      : part.type === "command"
        ? part.exitCode === null
          ? null
          : part.exitCode === 0
        : part.completedOutcome
          ? part.completedOutcome === "succeeded"
          : null
  const resultNote =
    row.resolution === "completed_unobserved"
      ? `; resultado: ${result === null ? "desconhecido" : result ? "sucesso" : "falha"}`
      : ""
  return `${JSON.stringify(bounded({ value: name, max: 120 }))} (${JSON.stringify(bounded({ value: part.callId, max: 120 }))}): ${row.resolution}${resultNote}${detail ? `; saída parcial/registrada: ${bounded({ value: detail, max: 350 })}` : ""}`
}

export const summarizeToolResolutions = (
  database: Database,
  store: StoreApi,
  threadId: string,
  leafId?: string,
): string | null => {
  const path = store.activePath({ threadId, ...(leafId ? { leafId } : {}) })
  const messages = new Set(path.map((message) => message.id))
  const runs = new Set(path.map((message) => message.runId).filter(Boolean))
  const rows = database
    .query(`SELECT t.run_id, r.request_message_id, t.part_json, t.resolution
    FROM tool_resolutions t JOIN runs r ON r.id = t.run_id
    WHERE t.thread_id = ? AND r.status IN ('succeeded','failed','canceled','interrupted')
      AND t.resolution IN ('cancelled_by_user','interrupted_by_restart','completed_unobserved')
    ORDER BY r.queued_at, t.call_id`)
    .all(threadId) as ResolutionRow[]
  const relevant = rows.filter(
    (row) => runs.has(row.run_id) || (row.request_message_id && messages.has(row.request_message_id)),
  )
  if (!relevant.length) return null
  const latest = relevant.slice(-30)
  return [
    "[touri: reconciliação das ferramentas de turnos anteriores]",
    ...(relevant.length > latest.length ? ["Chamadas mais antigas estão disponíveis em history_read."] : []),
    ...latest.map(describe),
    "cancelled_by_user e interrupted_by_restart indicam ausência de resultado final observado; podem existir efeitos parciais. Verifique o estado antes de repetir. completed_unobserved preserva um resultado concluído que não apareceu na resposta anterior.",
  ].join("\n")
}
