import { createRoot } from "react-dom/client"
import App from "../../src/App"
import { createMockApi } from "../../src/api/mock"
import { installMotionTokens } from "../../src/design/spring"
import { initializeTheme } from "../../src/design/theme"
import "../../src/styles.css"

// Portuguese-only evidence data; the shared mock adapter remains unchanged.
const api = createMockApi()
const state = api.getState()
for (const bot of state.bots) {
  bot.title = bot.name === "mark" ? "Comunicação" : bot.name === "onb" ? "Operações" : "Pesquisa"
  bot.roleLine = bot.title
}
for (const thread of state.threads) thread.title = "Revisão da campanha"
for (const message of state.messages) {
  message.text =
    message.role === "user" ? "Revise a campanha da semana." : "Vou organizar os próximos passos da campanha."
  message.parts = [{ type: "text", text: message.text }]
}
const { routines } = await api.request("GET /routines", {})
for (const routine of routines) routine.name = "Resumo do dia"
api.notify({
  kind: "done",
  title: "Resumo concluído",
  body: "O resumo da campanha está pronto para revisar.",
  botId: "bot-mark",
  threadId: "thread-mark",
  botName: "mark",
})
installMotionTokens(document.documentElement)
initializeTheme()
const root = document.getElementById("root")
if (root) createRoot(root).render(<App kernel={{ services: { api } }} />)
