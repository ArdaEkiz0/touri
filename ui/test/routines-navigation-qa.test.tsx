import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ApprovalPart, Message } from "@touri/contracts"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import App from "../src/App"
import { createMockApi } from "../src/api/mock"
import { ApprovalCard } from "../src/components/ApprovalCard"
import { Sidebar } from "../src/components/BotSidebar"
import { VirtualMessageList } from "../src/components/ChatPanel"

beforeEach(() => {
  document.documentElement.dataset.motion = "reduce"
})
afterEach(() => {
  delete document.documentElement.dataset.motion
})

it("F012 offers explicit routine activation in the chat approval card", async () => {
  const api = createMockApi()
  const part: ApprovalPart = {
    type: "approval",
    approvalId: "routine-approval",
    request: "permission",
    decision: "pending",
    allowStanding: false,
    scope: { source: "mcp", server: "touri", tool: "routine_create" },
    detail:
      'routine_create: {"routineId":"routine-daily","name":"Resumo diário QA","prompt":"Me mande aqui um resumo","cron":"0 9 * * *","timezone":"America/Sao_Paulo"}',
  }
  const message = {
    ...api.getState().messages[0],
    id: "routine-reply",
    role: "assistant",
    text: "",
    parts: [part],
  } as Message
  render(<VirtualMessageList messages={[message]} api={api} onSwitchBranch={vi.fn()} onRetry={vi.fn()} />)
  const card = screen.getByRole("article", { name: "Aprovação de ferramenta" })
  expect(card).toHaveTextContent("Resumo diário QA")
  expect(card).toHaveTextContent("Todo dia às 09:00 · horário de São Paulo")
  expect(within(card).queryByRole("button", { name: "Sempre neste bot" })).toBeNull()
  fireEvent.click(within(card).getByRole("button", { name: "Ativar rotina" }))
  await waitFor(() =>
    expect(api.calls).toContainEqual({
      route: "POST /approvals/:id",
      input: { decision: "approved", standing: false },
      pathValues: { id: "routine-approval" },
    }),
  )
})

it("F012 distinguishes creation permission from the later activation action", () => {
  render(
    <ApprovalCard
      api={createMockApi()}
      part={{
        type: "approval",
        approvalId: "creation-approval",
        request: "permission",
        decision: "pending",
        allowStanding: false,
        scope: { source: "mcp", server: "touri", tool: "routine_create" },
        detail: 'routine_create: {"name":"Resumo diário QA","cron":"0 9 * * *","timezone":"America/Sao_Paulo"}',
      }}
    />,
  )
  expect(screen.getByText("Criar rotina")).toBeVisible()
  expect(screen.getByRole("button", { name: "Aprovar", exact: true })).toBeVisible()
  expect(screen.queryByRole("button", { name: "Ativar rotina" })).toBeNull()
})

it("F013 describes the daily schedule in settings and the Rotinas navigation", async () => {
  const api = createMockApi()
  await api.request("PATCH /routines/:id", { cron: "0 9 * * *" }, { id: "routine-daily" })
  render(<App kernel={{ services: { api } }} />)
  await screen.findByRole("textbox", { name: "Mensagem para mark" })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configurações de mark" }))
  })
  const dialog = screen.getByRole("dialog")
  fireEvent.click(within(dialog).getByRole("tab", { name: "Rotinas" }))
  expect(within(dialog).getByText("Todo dia às 09:00 · horário de São Paulo")).toBeVisible()
  fireEvent.click(within(dialog).getByText("Detalhes do agendamento"))
  expect(within(dialog).getByText("0 9 * * * · America/Sao_Paulo")).toBeVisible()
  fireEvent.click(within(dialog).getByRole("button", { name: "Fechar diálogo" }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "touri" }))
  const sidebar = screen.getByRole("navigation", { name: "Barra lateral" })
  expect(within(sidebar).getByRole("button", { name: /Rotinas/ })).toBeVisible()
  expect(screen.getByRole("heading", { name: "Rotinas" })).toBeVisible()
  const routines = screen.getByRole("region", { name: "Rotinas" })
  expect(within(routines).getByText("Todo dia às 09:00 · horário de São Paulo")).toBeVisible()
})

it("F014 closes another bot's menu through navigation, settings and outside interaction", async () => {
  const api = createMockApi()
  render(<App kernel={{ services: { api } }} />)
  await screen.findByRole("textbox", { name: "Mensagem para mark" })
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Ações de mark" }))
  open()
  expect(screen.getByRole("menu", { name: "Ações de mark" })).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "touri" }))
  expect(screen.queryByRole("menu")).toBeNull()
  const sidebar = screen.getByRole("navigation", { name: "Barra lateral" })
  fireEvent.click(sidebar.querySelector('[data-bot-entry="bot-onb"] .bot-row-main') as HTMLElement)
  await screen.findByRole("textbox", { name: "Mensagem para onb" })
  open()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Configurações de onb" }))
  })
  const dialog = screen.getByRole("dialog")
  fireEvent.click(within(dialog).getByRole("tab", { name: "Rotinas" }))
  fireEvent.click(within(dialog).getByRole("button", { name: "Fechar diálogo" }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(screen.queryByRole("menu")).toBeNull()
  open()
  fireEvent.pointerDown(screen.getByRole("textbox", { name: "Mensagem para onb" }))
  expect(screen.queryByRole("menu")).toBeNull()
  open()
  fireEvent.keyDown(document, { key: "Escape" })
  expect(screen.queryByRole("menu")).toBeNull()
  open()
  await act(async () => {
    fireEvent.keyDown(window, { key: "n", metaKey: true })
  })
  expect(screen.getByRole("dialog", { name: "Criar um bot" })).toBeVisible()
  expect(screen.queryByRole("menu")).toBeNull()
})

it.each([
  { section: "touri" as const },
  { touriPage: "mcp" as const },
  { selectedBotId: "bot-onb" },
  { selectedThreadId: "another-thread" },
])("F014 dismisses stale menus on navigation without a pointer event: %j", (navigation) => {
  const state = createMockApi().getState()
  const props: Parameters<typeof Sidebar>[0] = {
    bots: state.bots,
    threads: state.threads,
    messages: [],
    notifications: [],
    routineCount: 0,
    showFakeTrafficLights: false,
    selectedBotId: "bot-mark",
    selectedThreadId: "thread-mark",
    section: "bots",
    touriPage: "cron",
    onSection: vi.fn(),
    onTouriPage: vi.fn(),
    onSelect: vi.fn(),
    onSelectThread: vi.fn(),
    onReviewApproval: vi.fn(),
    onNewThread: vi.fn(),
    onNewBot: vi.fn(),
    onBotSettings: vi.fn(),
    onSettings: vi.fn(),
    onDoctor: vi.fn(),
    onSearch: vi.fn(),
    onNotificationsOpen: vi.fn(),
    notificationActions: {
      open: vi.fn(),
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      respond: vi.fn(),
      reply: vi.fn(),
    },
  }
  const view = render(<Sidebar {...props} />)
  const trigger = screen.getByRole("button", { name: "Ações de mark" })
  fireEvent.click(trigger)
  expect(screen.getByRole("menu", { name: "Ações de mark" })).toBeVisible()
  view.rerender(<Sidebar {...props} {...navigation} />)
  expect(screen.queryByRole("menu")).toBeNull()
  expect(trigger).toHaveAttribute("aria-expanded", "false")
})
