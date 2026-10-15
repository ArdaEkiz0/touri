import { createRoot } from "react-dom/client"
import App from "../../src/App"
import { createMockApi } from "../../src/api/mock"
import "../../src/styles.css"

const api = createMockApi()
const state = api.getState()
const thread = state.threads.find((thread) => thread.id === "thread-mark")
if (!thread) throw new Error("Missing R7 fixture thread")
const text =
  "## Resultado\n\n**Origem:** `README.md`\n\n- [ ] Critério pendente\n- [x] Critério concluído\n- Bullet comum\n\n[Documentação](https://example.test)"
const message = {
  id: "r7-checklist",
  threadId: thread.id,
  parentId: null,
  role: "assistant" as const,
  kind: "text" as const,
  status: "complete" as const,
  runId: null,
  text,
  parts: [{ type: "text" as const, text }],
  sender: null,
  source: "local" as const,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}
state.messages.push(message)
thread.activeLeafId = message.id
const root = document.getElementById("root")
if (root) createRoot(root).render(<App kernel={{ services: { api } }} />)
