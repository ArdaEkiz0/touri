import { createRoot } from "react-dom/client"
import App from "../../src/App"
import { createMockApi } from "../../src/api/mock"
import "../../src/styles.css"

const api = createMockApi()
const state = api.getState()
const thread = state.threads.find((thread) => thread.id === "thread-mark")
if (!thread) throw new Error("Missing visual fixture thread")
thread.title = "QA · Oct 12, 8:00 PM"
for (let i = state.messages.length - 1; i >= 0; i--)
  if (state.messages[i]?.threadId === thread.id) state.messages.splice(i, 1)
const message = {
  id: "r4-table",
  threadId: thread.id,
  parentId: null,
  role: "assistant" as const,
  kind: "text" as const,
  status: "complete" as const,
  runId: null,
  text: "| # | Pull request |\n| --- | --- |\n| 113 | Corrigir VM |\n| 112 | Recuperar cron |\n| 111 | Restaurar ramificações |",
  parts: [],
  sender: null,
  source: "local" as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}
state.messages.push({ ...message, parts: [{ type: "text", text: message.text }] })
thread.activeLeafId = message.id
Object.assign(window, { r4Api: api })
const root = document.getElementById("root")
if (root) createRoot(root).render(<App kernel={{ services: { api } }} />)
