import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Message } from "@touri/contracts"
import { describe, expect, it } from "vitest"
import App from "../src/App"
import { createMockApi } from "../src/api/mock"

describe("Grupos", () => {
  it("introduces every member and group routing without showing the first bot's settings", async () => {
    const api = createMockApi()
    await api.request("POST /groups", {
      name: "Equipe QA",
      color: "#dc2626",
      avatarShape: "cercle",
      memberIds: ["bot-mark", "bot-onb"],
      coordinatorBotId: null,
    })
    render(<App kernel={{ services: { api } }} />)
    await screen.findByRole("textbox", { name: "Mensagem para mark" })
    fireEvent.click(within(screen.getByRole("region", { name: "Grupos" })).getByRole("button", { name: "Equipe QA" }))
    await screen.findByRole("textbox", { name: "Mensagem para Equipe QA" })
    const welcome = screen.getByRole("region", { name: "Comece uma conversa com Equipe QA" })
    expect(within(welcome).getByRole("heading", { name: "Comece uma conversa com Equipe QA" })).toBeVisible()
    expect(within(welcome).getByText(/todos os membros respondem na ordem da lista/)).toBeVisible()
    expect(within(welcome).getByRole("list", { name: "Membros do grupo" })).toHaveTextContent("mark")
    expect(within(welcome).getByRole("list", { name: "Membros do grupo" })).toHaveTextContent("onb")
    expect(screen.queryByRole("heading", { name: "Comece uma conversa com mark" })).toBeNull()
    const panel = screen.getByRole("complementary", { name: "Painel do grupo Equipe QA" })
    expect(within(panel).getByText("Seu grupo")).toBeVisible()
    expect(within(panel).queryByRole("button", { name: "Permissões" })).toBeNull()
    expect(screen.queryByRole("complementary", { name: "Painel de mark" })).toBeNull()
    fireEvent.click(within(panel).getByRole("button", { name: "Fechar painel do grupo" }))
    fireEvent.click(screen.getByRole("button", { name: "Painel do grupo" }))
    expect(screen.getByRole("complementary", { name: "Painel do grupo Equipe QA" })).toBeVisible()
  })

  it("F026/F027: exposes every mention, announces arrow selection and uses the singular after deletion", async () => {
    const user = userEvent.setup()
    const api = createMockApi()
    const [first, second] = api.getState().bots
    if (!first || !second) throw new Error("Missing members")
    first.name = "Bia QA"
    second.name = "Nico VM QA"
    await api.request("POST /groups", {
      name: "Equipe QA",
      color: "#dc2626",
      avatarShape: "cercle",
      memberIds: [first.id, second.id],
      coordinatorBotId: first.id,
    })
    render(<App kernel={{ services: { api } }} />)
    await screen.findByRole("textbox", { name: "Mensagem para Bia QA" })
    await user.click(screen.getByRole("button", { name: /^Equipe QA$/ }))
    const input = await screen.findByRole("textbox", { name: "Mensagem para Equipe QA" })
    expect(screen.getByRole("button", { name: "Escolher modelo: Grupo · 2 membros" })).toBeVisible()
    await user.click(input)
    await user.type(input, "@")
    const list = screen.getByRole("listbox", { name: "Mencionar membro" })
    const options = within(list).getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAccessibleName("@Bia QA")
    expect(options[1]).toHaveAccessibleName("@Nico VM QA")
    expect(document.getElementById(input.getAttribute("aria-activedescendant") ?? "")).toBe(options[0])
    await user.keyboard("{ArrowDown}")
    expect(options[1]).toHaveAttribute("aria-selected", "true")
    expect(document.getElementById(input.getAttribute("aria-activedescendant") ?? "")).toBe(options[1])
    expect(input).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(input).toHaveValue('@"Nico VM QA" ')
    expect(input).not.toHaveAttribute("aria-activedescendant")
    expect(screen.queryByRole("listbox", { name: "Mencionar membro" })).toBeNull()
    await user.clear(input)
    await user.type(input, "@")
    await user.keyboard("{ArrowUp}")
    expect(
      within(screen.getByRole("listbox", { name: "Mencionar membro" })).getByRole("option", { name: "@Nico VM QA" }),
    ).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{Enter}")
    expect(input).toHaveValue('@"Nico VM QA" ')
    await act(async () => {
      await api.request("DELETE /bots/:id", { name: second.name, deleteVolumes: false }, { id: second.id })
    })
    await waitFor(() => expect(screen.getByRole("button", { name: "Escolher modelo: Grupo · 1 membro" })).toBeVisible())
  })

  it("creates a group, completes @mentions with keyboard, edits membership and opens own conversations", async () => {
    const api = createMockApi()
    render(<App kernel={{ services: { api } }} />)
    await screen.findByRole("textbox", { name: "Mensagem para mark" })
    fireEvent.click(screen.getByRole("button", { name: "Criar grupo" }))
    const modal = screen.getByRole("dialog", { name: "Criar grupo" })
    fireEvent.change(within(modal).getByLabelText("Nome do grupo"), { target: { value: "Produto" } })
    fireEvent.click(within(modal).getByLabelText("mark"))
    fireEvent.click(within(modal).getByLabelText("onb"))
    fireEvent.change(within(modal).getByLabelText("Coordenador"), { target: { value: "bot-mark" } })
    fireEvent.click(within(modal).getByRole("button", { name: "Criar grupo" }))
    const composer = await screen.findByRole("textbox", { name: "Mensagem para Produto" })
    expect(screen.getByText("mark · coordenador, onb")).toBeVisible()
    const payload = api.calls.find((c) => c.route === "POST /groups")?.input
    expect(payload).toMatchObject({ name: "Produto", memberIds: ["bot-mark", "bot-onb"], coordinatorBotId: "bot-mark" })
    fireEvent.focus(composer)
    fireEvent.change(composer, { target: { value: "@on", selectionStart: 3 } })
    expect(screen.getByRole("option", { name: "@onb" })).toBeVisible()
    fireEvent.keyDown(composer, { key: "Enter" })
    expect(composer).toHaveValue("@onb ")
    expect(api.calls.filter((c) => c.route === "POST /threads/:id/messages")).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Editar grupo" }))
    const edit = screen.getByRole("dialog", { name: "Editar grupo" })
    fireEvent.click(within(edit).getByLabelText("mark"))
    expect(within(edit).getByLabelText("Coordenador")).toHaveValue("")
    fireEvent.click(within(edit).getByRole("button", { name: "Salvar grupo" }))
    await screen.findByRole("textbox", { name: "Mensagem para Produto" })
    expect(api.calls.find((c) => c.route === "PATCH /groups/:id")?.input).toMatchObject({
      memberIds: ["bot-onb"],
      coordinatorBotId: null,
    })
    fireEvent.click(screen.getByRole("button", { name: "+ Nova conversa" }))
    await within(screen.getByRole("region", { name: "Grupos" })).findByRole("button", {
      name: "Nova conversa",
    })
    expect(api.calls.some((c) => c.route === "POST /groups/:id/threads")).toBe(true)
  })
  it("F028: preserves sender identity with a neutral deleted-member avatar in existing history", async () => {
    const api = createMockApi()
    const created = await api.request("POST /groups", {
      name: "Equipe",
      color: "#dc2626",
      avatarShape: "cercle",
      memberIds: ["bot-mark", "bot-onb"],
      coordinatorBotId: "bot-mark",
    })
    render(<App kernel={{ services: { api } }} />)
    await screen.findByRole("textbox", { name: "Mensagem para mark" })
    fireEvent.click(screen.getByRole("button", { name: /^Equipe$/ }))
    await screen.findByRole("textbox", { name: "Mensagem para Equipe" })
    const message: Message = {
      id: "group-reply",
      threadId: created.thread.id,
      parentId: null,
      role: "assistant",
      kind: "text",
      status: "complete",
      runId: null,
      text: "Revisão concluída",
      parts: [{ type: "text", text: "Revisão concluída" }],
      sender: { id: "bot-onb", name: "onb" },
      source: "local",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    act(() => api.emit({ type: "message.created", message }))
    const row = document.querySelector('[data-message-id="group-reply"]')
    expect(row?.querySelector(".message-role")?.textContent).toBe("onb")
    expect(row?.querySelector(".tb-avatar")).toBeTruthy()
    expect(row?.querySelector(".tb-avatar")).toHaveAttribute("data-bot-id", "bot-onb")
    await act(async () => {
      await api.request("DELETE /bots/:id", { name: "onb", deleteVolumes: false }, { id: "bot-onb" })
    })
    const deleted = await within(row as HTMLElement).findByRole("img", { name: "Membro excluído: onb" })
    expect(deleted.querySelector(".tb-avatar")).toHaveAttribute("data-bot-id", "bot-onb")
    expect(row?.querySelector('[data-bot-id="bot-mark"]')).toBeNull()
    expect(row?.querySelector(".message-role")).toHaveTextContent("onb")
  })
})
