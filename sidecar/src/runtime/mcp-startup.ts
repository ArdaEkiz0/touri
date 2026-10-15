import { parseMcpShimStage } from "../mcp/startup-stage"
import { asRecord } from "./utils"

export const MCP_STARTUP_MESSAGE = "As ferramentas do touri não carregaram nesta máquina"

export const isMcpStartupError = (text: string | null | undefined): boolean =>
  typeof text === "string" && text.startsWith(MCP_STARTUP_MESSAGE)

/** The run error for a failed tool startup; the bracketed stage is rendered by the run-failure card. */
export const mcpStartupError = ({ diagnostic }: { diagnostic: string }): string =>
  `${MCP_STARTUP_MESSAGE} [etapa: ${parseMcpShimStage(diagnostic)}]`

/** Only inspect CLI diagnostics/control frames, never the assistant's prose. */
export const touriMcpStartupFailed = (value: unknown): boolean => {
  if (typeof value === "string")
    return /touri MCP startup failed|MCP server startup failed[^\n]*server_name["']?\s*[:=]\s*["']touri["']|MCP (?:client|server) for [`"']?touri[`"']?[^\n]*failed|touri[^\n]*handshaking with MCP server failed/i.test(
      value,
    )
  const frame = asRecord(value)
  if (!frame) return false
  const name = frame.name ?? frame.server ?? frame.serverName ?? frame.server_name
  const status = frame.status
  const statusType = typeof status === "string" ? status : asRecord(status)?.type
  if (name === "touri" && (statusType === "failed" || statusType === "error" || statusType === "disconnected"))
    return true
  if (Array.isArray(frame.failed) && frame.failed.some((item) => asRecord(item)?.server === "touri")) return true
  return Object.values(frame).some((item) =>
    Array.isArray(item) ? item.some(touriMcpStartupFailed) : touriMcpStartupFailed(item),
  )
}
