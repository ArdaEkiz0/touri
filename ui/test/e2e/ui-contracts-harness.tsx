import type { ToolCallPart } from "@touri/contracts"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { createMockApi } from "../../src/api/mock"
import { ActivityMark } from "../../src/components/ActivityMark"
import { ApprovalCard } from "../../src/components/ApprovalCard"
import { VirtualMessageList } from "../../src/components/ChatPanel"
import { useReveal } from "../../src/components/Reveal"
import { ToolCallCard } from "../../src/components/ToolCallCard"
import { installMotionTokens } from "../../src/design/spring"
import "../../src/styles.css"
import "../../src/components/bot-sidebar.css"
import "../../src/components/bot-panel.css"
import "../../src/components/Composer.css"

installMotionTokens(document.documentElement)
const api = createMockApi()
const tool: ToolCallPart = {
  type: "tool_call",
  callId: "visual-tool",
  tool: "Read",
  summary: "Ler arquivo",
  inputJson: '{"path":"/workspace/README.md"}',
  outputJson: "Arquivo disponível.\n".repeat(20),
  ok: true,
}
const base = api.getState().messages[0]
if (!base) throw new Error("Missing message fixture")
const Harness = () => {
  const [state, setState] = useState<"thinking" | "working-tool" | "typing" | "waiting-approval">("thinking")
  const [delta, setDelta] = useState(0)
  const ref = useReveal<HTMLFormElement>()
  return (
    <main style={{ padding: 24, height: "100%", overflow: "auto" }}>
      <h1>Superfícies touri</h1>
      <div style={{ display: "grid", gridTemplateColumns: "240px minmax(0, 1fr) 320px", gap: 24 }}>
        <aside className="r8-sidebar bot-sidebar" style={{ width: "auto" }}>
          <button className="sidebar-icon-button" type="button" aria-label="Nova conversa">
            +
          </button>
          <div className="bot-context-menu" role="menu" aria-label="Ações do bot">
            <button type="button" role="menuitem">
              Abrir conversa
            </button>
            <button type="button" role="menuitem">
              Renomear bot
            </button>
          </div>
          <div className="bot-panel-tabs">
            <button type="button">Computador</button>
          </div>
        </aside>
        <section>
          <div className="chat-message-list">
            <div className="message-bubble message-user">Vamos conferir o arquivo.</div>
          </div>
          <ActivityMark state={state} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(
              [
                ["thinking", "Pensar"],
                ["working-tool", "Usar ferramenta"],
                ["typing", "Escrever"],
                ["waiting-approval", "Aguardar aprovação"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setState(value)}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setDelta((value) => value + 1)}>
              Mais texto
            </button>
          </div>
          <ToolCallCard part={{ ...tool, outputJson: tool.outputJson + "Texto novo.\n".repeat(delta) }} />
          <ApprovalCard
            part={{
              type: "approval",
              approvalId: "visual-approval",
              request: "permission",
              detail: "Ler arquivo",
              decision: "pending",
            }}
            tool={{ ...tool, ok: null }}
            api={api}
          />
          <form className="composer" ref={ref}>
            <textarea aria-label="Mensagem" placeholder="Escreva uma mensagem" />
          </form>
        </section>
        <section
          className="modal-card"
          role="dialog"
          aria-label="Revisar tarefa"
          style={{ width: "auto", height: "fit-content" }}
        >
          <header className="modal-header">
            <h2>Revisar tarefa</h2>
          </header>
          <div className="modal-form">
            <p>Confira os detalhes antes de continuar.</p>
          </div>
          <footer className="modal-actions">
            <button type="button" className="button button-quiet">
              Voltar
            </button>
          </footer>
        </section>
      </div>
      <section style={{ height: 260, marginTop: 24, display: "flex" }} aria-label="Conversa com rolagem">
        <VirtualMessageList
          messages={Array.from({ length: 12 }, (_, index) => ({
            ...base,
            id: `anchor-${index}`,
            role: "assistant",
            text: `Mensagem ${index}`,
            parts: [
              { type: "text", text: `Mensagem ${index}` },
              { ...tool, callId: `anchor-tool-${index}` },
            ],
          }))}
          onSwitchBranch={() => undefined}
          onRetry={async () => undefined}
        />
      </section>
    </main>
  )
}
createRoot(document.getElementById("root") as HTMLElement).render(<Harness />)
