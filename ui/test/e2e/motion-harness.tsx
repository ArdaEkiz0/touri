import { useState } from "react"
import { createRoot } from "react-dom/client"
import { MotionPresence, MotionSkeleton } from "../../src/components/Motion"
import { AnimatedDisclosure } from "../../src/components/Reveal"
import { installMotionTokens } from "../../src/design/spring"
import "../../src/styles.css"

installMotionTokens(document.documentElement)
const Harness = () => {
  const [lines, setLines] = useState(1)
  const [notice, setNotice] = useState(false)
  return (
    <main className="app-shell" style={{ padding: 32, overflow: "auto" }}>
      <h1>Detalhes da conversa</h1>
      <AnimatedDisclosure summary="Contexto da conversa">
        <p>{"As anotações da conversa ficam disponíveis quando você precisar. ".repeat(lines)}</p>
        <button type="button" className="button button-quiet" onClick={() => setLines((value) => value + 3)}>
          Mais anotações
        </button>
      </AnimatedDisclosure>
      <AnimatedDisclosure summary="Arquivos da campanha">
        <p>Plano da semana · 3 arquivos</p>
      </AnimatedDisclosure>
      <AnimatedDisclosure summary="Preferências da seção">
        <label>
          <input type="checkbox" /> Mostrar detalhes
        </label>
      </AnimatedDisclosure>
      <p role="status">Carregando arquivos…</p>
      <MotionSkeleton />
      <button type="button" className="button button-quiet motion-press" onClick={() => setNotice(true)}>
        Mostrar aviso
      </button>
      <MotionPresence kind="toast" show={notice}>
        <div className="notice-bar" role="status">
          Preferências salvas.
          <button type="button" aria-label="Dispensar aviso" onClick={() => setNotice(false)}>
            ×
          </button>
        </div>
      </MotionPresence>
    </main>
  )
}
const root = document.getElementById("root")
if (root) createRoot(root).render(<Harness />)
