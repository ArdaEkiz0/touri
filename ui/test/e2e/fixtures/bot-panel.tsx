import type { MachineState } from "@touri/contracts"
import { createRoot } from "react-dom/client"
import App from "../../../src/App"
import { createMockApi } from "../../../src/api/mock"
import { installMotionTokens } from "../../../src/design/spring"
import { initializeTheme } from "../../../src/design/theme"
import "../../../src/styles.css"

const api = createMockApi()
const params = new URLSearchParams(location.search)
const bot = api.getState().bots.find((bot) => bot.id === "bot-mark")
if (bot) {
  bot.machine = "vm"
  bot.roleLine = "Pesquisa e planejamento"
  bot.computerUse = params.get("control") === "true"
}
let state: MachineState = {
  botId: "bot-mark",
  status: "stopped",
  progress: null,
  error: null,
  memoryMb: 2048,
  createdMs: null,
  startMs: null,
}
const request = api.request
api.request = async (route, input, path) => {
  if (route === "GET /machines")
    return { capability: { available: true, reason: null, provider: "mock" }, machines: [state] } as never
  const response = await request(route, input, path)
  if (route === "POST /bots/:id/machine/intent" && (input as { intent: string }).intent === "computer-open")
    state = (response as { machine: MachineState }).machine
  return response
}
Object.assign(window, {
  botPanelQa: {
    state: (status: MachineState["status"]) => {
      state = {
        ...state,
        status,
        progress: status === "starting" ? "Preparando a imagem Linux…" : null,
        error: status === "error" ? "Não foi possível preparar a imagem. Tente novamente." : null,
      }
      api.emit({ type: "machine.updated", machine: state })
    },
    api,
  },
})
installMotionTokens(document.documentElement)
initializeTheme()
const root = document.getElementById("root")
if (root) createRoot(root).render(<App kernel={{ services: { api } }} />)
