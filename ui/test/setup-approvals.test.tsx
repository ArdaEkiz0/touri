import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ApprovalPart, ToolCallPart } from "@touri/contracts"
import { afterEach, expect, it } from "vitest"
import { createMockApi } from "../src/api/mock"
import { ApprovalCard } from "../src/components/ApprovalCard"

afterEach(cleanup)

const approval = (tool: string, input: unknown): ApprovalPart => ({
  type: "approval",
  approvalId: "setup-approval",
  botId: "bot-a",
  request: "permission",
  scope: { source: "mcp", server: "touri", tool },
  detail: `${tool}: ${JSON.stringify(input)}`,
  allowStanding: false,
  decision: "pending",
})

it("project approval shows the reviewed project and replaced project, even when the provider passed only an ID", async () => {
  const api = createMockApi()
  const tool: ToolCallPart = {
    type: "tool_call",
    callId: "link",
    tool: "mcp__touri__project_link",
    summary: "project_link",
    inputJson: '{"projectId":"project-id"}',
    outputJson: null,
    ok: null,
  }
  render(
    <ApprovalCard
      api={api}
      tool={tool}
      part={approval("project_link", {
        path: "/Users/test/javascript/Hodler",
        name: "Hodler",
        previousProject: { name: "Anterior", path: "/Users/test/Anterior" },
      })}
    />,
  )
  expect(screen.getByText("Vincular projeto")).toBeInTheDocument()
  expect(
    screen.getByText(
      "Vincular Hodler (/Users/test/javascript/Hodler) a este bot Substitui o projeto Anterior (/Users/test/Anterior).",
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Sempre neste bot" })).toBeNull()
  const card = screen.getByRole("article", { name: "Aprovação de ferramenta" })
  fireEvent.keyDown(card, { key: "Enter" })
  const approve = screen.getByRole("button", { name: "Aprovar" })
  expect(fireEvent.keyDown(approve, { key: "Enter" })).toBe(false)
  expect(fireEvent.keyDown(approve, { key: " " })).toBe(false)
  expect(api.calls).toEqual([])
  fireEvent.click(approve)
  await screen.findByText("Aprovado por você")
  expect(api.calls).toContainEqual({
    route: "POST /approvals/:id",
    input: { decision: "approved", standing: false },
    pathValues: { id: "setup-approval" },
  })
})

for (const [mode, label] of [
  ["read", "Somente leitura"],
  ["read-write", "Leitura e escrita"],
] as const) {
  it(`folder approval shows ${label}, the canonical path and VM timing; Escape denies`, async () => {
    const api = createMockApi()
    render(
      <ApprovalCard
        api={api}
        part={approval("folder_access_request", { path: "/Users/test/Documents", mode, nextTurn: true })}
      />,
    )
    expect(screen.getByText("Conceder acesso à pasta")).toBeInTheDocument()
    expect(
      screen.getByText(
        `Permitir ${label} em /Users/test/Documents para este bot A mudança entra em vigor no próximo turno da VM.`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sempre neste bot" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("article", { name: "Aprovação de ferramenta" }), { key: "Escape" })
    await screen.findByText("Negado por você")
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        route: "POST /approvals/:id",
        input: { decision: "denied", standing: false },
        pathValues: { id: "setup-approval" },
      }),
    )
  })
}

it("folder upgrades show the old and requested permissions", () => {
  render(
    <ApprovalCard
      api={createMockApi()}
      part={approval("folder_access_request", {
        path: "/Users/test/Documents",
        mode: "read-write",
        previousMode: "read-only",
      })}
    />,
  )
  expect(
    screen.getByText(
      "Permitir Leitura e escrita em /Users/test/Documents para este bot Acesso anterior: Somente leitura.",
    ),
  ).toBeInTheDocument()
})

it("an external MCP tool with the same name keeps its own presentation", () => {
  render(
    <ApprovalCard
      api={createMockApi()}
      part={{
        ...approval("project_link", { path: "/external", name: "Other" }),
        scope: { source: "mcp", server: "external", tool: "project_link" },
      }}
    />,
  )
  expect(screen.getByText("external · project_link")).toBeInTheDocument()
  expect(screen.queryByText("Vincular projeto")).toBeNull()
})
