import type { MachineState } from "@touri/contracts"
import { createRoot } from "react-dom/client"
import App from "../../../src/App"
import { createMockApi } from "../../../src/api/mock"
import { installMotionTokens } from "../../../src/design/spring"
import { initializeTheme } from "../../../src/design/theme"
import "../../../src/styles.css"

const api = createMockApi()
const params = new URLSearchParams(location.search)
const seed = api.getState()
for (const bot of seed.bots) {
  bot.title = bot.name === "mark" ? "Pesquisa e planejamento" : bot.name === "onb" ? "Operações" : "Pesquisa"
  bot.section = "Equipe"
}
for (const thread of seed.threads) thread.title = "Planejamento da campanha"
for (const message of seed.messages) {
  message.text =
    message.role === "user"
      ? "Organize os materiais da próxima campanha."
      : "Os materiais estão reunidos na biblioteca. Podemos revisar as notas e preparar os próximos passos."
  message.parts = [{ type: "text", text: message.text }]
}
const bot = seed.bots.find((entry) => entry.id === "bot-mark")
if (bot) {
  bot.machine = params.has("local") ? "local" : "vm"
  bot.projectId = params.has("local") ? (params.has("project") ? "project-demo" : null) : bot.projectId
  bot.roleLine = "Pesquisa e planejamento"
  bot.computerUse = false
}
let machine: MachineState = {
  botId: "bot-mark",
  status: "stopped",
  progress: null,
  error: null,
  memoryMb: 2048,
  createdMs: null,
  startMs: null,
}
let folderFailure = true
let manyFiles = false
let loadingFolder = false
const state = (status: MachineState["status"]) => {
  machine = {
    ...machine,
    status,
    progress: status === "starting" ? "Preparando a imagem Linux…" : null,
    error: status === "error" ? "Não foi possível preparar a imagem. Tente novamente." : null,
  }
  api.emit({ type: "machine.updated", machine })
}
const request = api.request
api.isMock = false
api.websocketUrl = () => "ws://127.0.0.1/mock-desktop"
api.request = async (route, input, path) => {
  if (route === "GET /machines")
    return { capability: { available: true, reason: null, provider: "mock" }, machines: [machine] } as never
  if (route === "GET /routines") {
    const response = await request("GET /routines", {})
    return {
      ...response,
      routines: params.has("empty-routines")
        ? []
        : response.routines.map((routine) => ({ ...routine, name: "Resumo da campanha" })),
    } as never
  }
  if (route === "GET /bots/:id/files") {
    const directory = (input as { path: string }).path
    if (directory === "documentos" && loadingFolder) await new Promise((resolve) => setTimeout(resolve, 2000))
    if (directory === "restrita" && folderFailure) throw new Error("A pasta não pôde ser lida. [TOURI-E1001]")
    return {
      files: directory
        ? []
        : [
            { name: "documentos", path: "documentos", directory: true, bytes: 0 },
            { name: "restrita", path: "restrita", directory: true, bytes: 0 },
            ...(manyFiles
              ? Array.from({ length: 40 }, (_, index) => ({
                  name: `material-${String(index).padStart(2, "0")}.md`,
                  path: `material-${index}.md`,
                  directory: false,
                  bytes: 1536,
                }))
              : []),
            { name: "notas.md", path: "notas.md", directory: false, bytes: 2048 },
            { name: "planejamento.json", path: "planejamento.json", directory: false, bytes: 3072 },
            { name: "resultados.csv", path: "resultados.csv", directory: false, bytes: 9216 },
          ],
    } as never
  }
  if (route === "GET /bots/:id/files/content")
    return {
      name: "notas.md",
      mime: "text/markdown",
      base64: btoa(
        String.fromCharCode(
          ...new TextEncoder().encode(
            "# Notas da campanha\n\nTudo pronto para revisar a campanha de outubro.\n\n## Próximos passos\n\n- Revisar os materiais\n- Conferir os resultados\n- Preparar a nova campanha\n\n" +
              "Os materiais ficam reunidos nesta pasta para facilitar o trabalho da equipe.\n\n".repeat(20),
          ),
        ),
      ),
    } as never
  if (route === "POST /bots/:id/desktop")
    return { sessionId: "r8-mock", path: "/mock-desktop", control: false } as never
  if (route === "DELETE /desktop/:id") return {} as never
  const response = await request(route, input, path)
  if (route === "POST /bots/:id/machine/intent") machine = (response as { machine: MachineState }).machine
  return response
}
Object.assign(window, {
  botPanelQa: {
    state,
    api,
    folderFailure: (value: boolean) => {
      folderFailure = value
    },
    manyFiles: () => {
      manyFiles = true
    },
    loadingFolder: () => {
      loadingFolder = true
    },
  },
})
installMotionTokens(document.documentElement)
initializeTheme()
const root = document.getElementById("root")
if (root) createRoot(root).render(<App kernel={{ services: { api } }} />)
