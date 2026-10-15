import type { MachineState, ToolCallPart } from "@touri/contracts"
import { createRoot } from "react-dom/client"
import { createApiClient } from "../../../src/api/client"
import { InlineLivePreview, InlinePreviewContext } from "../../../src/features/desktop/InlineLivePreview"
import "../../../src/styles.css"

// Mounts the real chat preview against a real sidecar, exactly as ChatPanel does for a running browser tool.
const params = new URLSearchParams(location.search)
const endpoint = params.get("endpoint") ?? ""
const api = createApiClient({
  endpoint: { baseUrl: endpoint, wsUrl: `${endpoint.replace("http:", "ws:")}/api/v1/events`, token: "dev-ui-token" },
})
const { bots } = await api.request("GET /bots", {})
const bot = bots.find((entry) => entry.id === params.get("bot")) ?? null
const machine: MachineState = { botId: bot?.id ?? "", status: "running" } as MachineState
const tool: ToolCallPart = {
  type: "tool_call",
  tool: "mcp__touri__browser_open",
  callId: "inline-proof",
  inputJson: "{}",
  outputJson: null,
  summary: "MCP tool call",
  ok: null,
}
const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <InlinePreviewContext.Provider value={{ api, bot, machine, activeCallId: tool.callId, onOpenComputer: () => {} }}>
      <InlineLivePreview parts={[tool]} finished={false} />
    </InlinePreviewContext.Provider>,
  )
