import "../../../src/styles.css"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { ActivityMark } from "../../../src/components/ActivityMark"
import { BotAvatar } from "../../../src/components/BotAvatar"
import { type MascotState, mascotLabel } from "../../../src/components/mascotState"

const states = Object.keys(mascotLabel) as MascotState[]
const bot = { id: "mascot-demo", avatarSeed: "touri-mascot", name: "touri", color: null }
const Fixture = () => {
  const [state, setState] = useState<MascotState>("thinking")
  return (
    <main style={{ padding: 32, maxWidth: 960 }}>
      <h1>touri · estados do mascote</h1>
      <label>
        Estado{" "}
        <select aria-label="Estado" value={state} onChange={(event) => setState(event.target.value as MascotState)}>
          {states.map((item) => (
            <option key={item} value={item}>
              {mascotLabel[item]}
            </option>
          ))}
        </select>
      </label>
      <article id="probe" style={{ margin: "24px 0", padding: 24, background: "var(--panel)", borderRadius: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BotAvatar bot={bot} state={state} motion="always" size={40} />
          <strong>{mascotLabel[state]}</strong>
        </div>
        <p>Vou organizar o próximo passo.</p>
        <ActivityMark
          state={state}
          bot={bot}
          parts={[{ type: "command", callId: "demo", command: "pwd", cwd: "/project", outputTail: "", exitCode: null }]}
        />
      </article>
      <div id="gallery" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 24 }}>
        {states.map((item) => (
          <div key={item} data-state={item} style={{ display: "grid", justifyItems: "center", gap: 12, padding: 16 }}>
            <BotAvatar bot={bot} state={item} motion="always" size={40} />
            <small>{mascotLabel[item]}</small>
          </div>
        ))}
      </div>
    </main>
  )
}
const root = document.getElementById("root")
if (root) createRoot(root).render(<Fixture />)
