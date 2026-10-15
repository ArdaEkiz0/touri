import type { Message } from "@touri/contracts"
import { createRoot } from "react-dom/client"
import { VirtualMessageList } from "../../src/components/ChatPanel"
import { ToolCallCard } from "../../src/components/ToolCallCard"
import { screenshotJoined, screenshotSegments } from "../fixtures/markdown-bug"
import "../../src/styles.css"

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get("theme") ?? "dark"
const legacy = params.get("view") === "history"
const message: Message = {
  id: "screenshot",
  threadId: "fixture",
  parentId: null,
  role: "assistant",
  kind: "text",
  status: "complete",
  runId: null,
  text: legacy ? screenshotJoined : screenshotSegments.join(""),
  parts: legacy
    ? [{ type: "text", text: screenshotJoined }]
    : screenshotSegments.map((text) => ({ type: "text", text })),
  sender: null,
  source: "local",
  createdAt: 1_792_009_800_000,
  updatedAt: 1_792_009_800_000,
}
const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 24 }}>
      <VirtualMessageList messages={[message]} onSwitchBranch={() => {}} onRetry={async () => {}} />
      <section className="harness-tools" aria-label="Exemplos de saída">
        <ToolCallCard
          part={{
            type: "command",
            callId: "ansi",
            command: "bun test",
            cwd: "/workspace",
            exitCode: 0,
            outputTail:
              "\u001b[32m✓ Testes concluídos\u001b[0m\n\u001b[38;5;33mANSI 256\u001b[0m · \u001b[38;2;130;90;210mTruecolor\u001b[0m",
          }}
        />
        <ToolCallCard
          part={{
            type: "command",
            callId: "failure",
            command: "bun run check",
            cwd: "/workspace",
            exitCode: 1,
            outputTail: '{"ok":false,"falhas":2}',
          }}
        />
        <ToolCallCard
          part={{
            type: "file_change",
            callId: "diff",
            paths: ["chat.ts"],
            resolution: "succeeded",
            diff: "@@ -1 +1 @@\n-texto concatenado\n+parágrafos separados",
          }}
        />
      </section>
    </main>,
  )
