import { expect, test, vi } from "vitest"
import { createMockApi } from "../src/api/mock"

test("default demo SOULs specify Portuguese from the first response", async () => {
  const api = createMockApi()
  const { bots } = await api.request("GET /bots", {})
  const { bot } = await api.request("POST /bots", {
    name: "acme-release-v2",
    provider: "codex",
  })
  for (const current of [...bots, bot]) {
    expect(current.instructions).toContain("Responda em pt-BR desde a primeira mensagem")
    expect(current.instructions).toContain("idioma solicitado pelo usuário")
  }
})

test("the first demo reply uses pt-BR too", async () => {
  vi.useFakeTimers()
  try {
    const api = createMockApi()
    const { thread } = await api.request("POST /threads", { botId: "bot-mark", title: "Primeira conversa" })
    await api.request(
      "POST /threads/:id/messages",
      { threadId: thread.id, text: "Olá", parentId: null, attachmentIds: [] },
      { id: thread.id },
    )
    await vi.runAllTimersAsync()
    const { messages } = await api.request("GET /threads/:id/messages", {}, { id: thread.id })
    expect(messages.find((message) => message.role === "assistant")?.text).toBe(
      "Coloquei sua solicitação na fila local. Vou manter o contexto da conversa, e o próximo passo está pronto.",
    )
  } finally {
    vi.useRealTimers()
  }
})
