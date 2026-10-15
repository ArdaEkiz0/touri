import { invoke } from "@tauri-apps/api/core"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { Message } from "@touri/contracts"
import { describe, expect, it, vi } from "vitest"
import { VirtualMessageList } from "../src/components/ChatPanel"
import { MarkdownContent } from "../src/components/MarkdownContent"
import { ToolCallCard } from "../src/components/ToolCallCard"
import { messageMarkdown, recoverLegacyMarkdown } from "../src/messageMarkdown"
import { applyDelta } from "../src/useWorkspace"
import { screenshotJoined, screenshotSegments } from "./fixtures/markdown-bug"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))

const message = (parts: Message["parts"], text: string): Message => ({
  id: "markdown",
  threadId: "fixture",
  parentId: null,
  role: "assistant",
  kind: "text",
  status: "complete",
  runId: null,
  parts,
  text,
  sender: null,
  source: "local",
  createdAt: 1,
  updatedAt: 1,
})

describe("Codex screenshot regression", () => {
  for (const legacy of [false, true]) {
    it(`renders a real table and separate paragraphs from ${legacy ? "persisted flattened text" : "separate items with a stale text cache"}`, async () => {
      const original = message(
        legacy
          ? [{ type: "text", text: screenshotJoined }]
          : screenshotSegments.map((text) => ({ type: "text", text })),
        legacy ? screenshotJoined : screenshotSegments.join(""),
      )
      const view = render(
        <VirtualMessageList messages={[original]} onSwitchBranch={vi.fn()} onRetry={vi.fn(async () => {})} />,
      )
      expect(await screen.findByRole("table")).toBeVisible()
      expect(screen.getAllByRole("row")).toHaveLength(4)
      expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
        "URL",
        "Título",
        "Primeiro botão",
      ])
      expect(view.container.querySelectorAll(".markdown-content > p").length).toBeGreaterThan(5)
      expect(view.container.querySelectorAll(".markdown-content li")).toHaveLength(4)
      expect(screen.getByText(screenshotSegments[0] as string, { selector: "p" })).toBeVisible()
      expect(original.text).toBe(legacy ? screenshotJoined : screenshotSegments.join(""))
      expect(view.container.querySelector(".markdown-table")).toHaveAttribute("tabindex", "0")
    })
  }

  it("preserves valid Markdown, code containing pipes, and incomplete table-like prose", () => {
    const source = screenshotSegments.join("\n\n")
    expect(recoverLegacyMarkdown(source)).toBe(source)
    for (const text of [
      "`| A | B | |---|---| | 1 | 2 |`",
      "```text\n| A | B | |---|---| | 1 | 2 |\n```",
      "Exemplo | A | B | |---|---| incompleto",
      "A | B sem tabela",
    ])
      expect(recoverLegacyMarkdown(text)).toBe(text)
    expect(recoverLegacyMarkdown("Antes. | A | B | | :--- | ---: | | um\\|dois | três | Depois.")).toBe(
      "Antes.\n\n| A | B |\n| :--- | ---: |\n| um\\|dois | três |\n\nDepois.",
    )
    expect(messageMarkdown({ role: "user", parts: [], text: screenshotJoined })).toBe(screenshotJoined)
  })

  it("replays deltas with blank item boundaries and Markdown newlines without altering offsets", () => {
    let current = message([{ type: "text", text: "" }], "")
    current.status = "streaming"
    for (const [index, segment] of screenshotSegments.entries()) {
      const delta = `${index ? "\n\n" : ""}${segment}`
      const event = {
        type: "message.delta" as const,
        threadId: current.threadId,
        messageId: current.id,
        partIndex: 0,
        offset: current.text.length,
        delta,
        updatedAt: 1,
      }
      current = applyDelta([current], current.id, delta, 0, event.offset, event)[0] as Message
      expect(applyDelta([current], current.id, delta, 0, event.offset, event)[0]).toEqual(current)
    }
    expect(messageMarkdown(current)).toBe(screenshotSegments.join("\n\n"))
  })
})

it("renders full GFM while rejecting HTML and unsafe links", async () => {
  const view = render(
    <MarkdownContent
      content={
        '# Título\n\n## Seção\n\n### Detalhe\n\n- item\n  - aninhado\n\n1. primeiro\n2. segundo\n\n- [x] pronto\n- [ ] pendente\n\n> Citação\n\nUse `arquivo.ts` e [site](https://example.test).\n\n[perigoso](javascript:alert%281%29)\n\n<img src=x onerror="alert(1)"><script>alert(1)</script>\n\n```json\n{"ok":true,"total":2}\n```'
      }
    />,
  )
  expect(await screen.findByRole("heading", { name: "Título", level: 1 })).toBeVisible()
  expect(screen.getByRole("heading", { name: "Seção", level: 2 })).toBeVisible()
  expect(screen.getAllByRole("checkbox")).toHaveLength(2)
  expect(screen.getAllByRole("checkbox")[0]).toBeChecked()
  expect(view.container.querySelector("blockquote")).toHaveTextContent("Citação")
  expect(view.container.querySelector("ol li")).toHaveTextContent("primeiro")
  expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("target", "_blank")
  expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("rel", "noopener noreferrer")
  expect(view.container.querySelector('a[href^="javascript:"], img, script')).toBeNull()
  await waitFor(() => expect(view.container.querySelector(".markdown-highlight .shiki")).not.toBeNull())
  expect(view.container.querySelector(".markdown-highlight")).toHaveTextContent('{"ok":true,"total":2}')
  expect(view.container.querySelector('.markdown-highlight span[style*="--syntax-"]')).not.toBeNull()
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} })
  try {
    fireEvent.click(screen.getByRole("link", { name: "site" }))
    expect(invoke).toHaveBeenCalledWith("open_external", { url: "https://example.test" })
  } finally {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
  }
})

it("highlights JSON and diffs and labels successful and failed exits", async () => {
  const view = render(
    <>
      <ToolCallCard
        part={{
          type: "command",
          callId: "ok",
          command: "echo ok",
          cwd: "/workspace",
          exitCode: 0,
          outputTail: '{"ok":true,"total":2}',
        }}
      />
      <ToolCallCard
        part={{
          type: "command",
          callId: "fail",
          command: "false",
          cwd: "/workspace",
          exitCode: 2,
          outputTail: "Falha",
        }}
      />
      <ToolCallCard
        part={{
          type: "file_change",
          callId: "diff",
          paths: ["chat.ts"],
          resolution: "succeeded",
          diff: "@@ -1 +1 @@\n-antigo\n+novo",
        }}
      />
    </>,
  )
  expect(screen.getByText("Saída 0 · OK")).toHaveClass("tool-exit-ok")
  expect(screen.getByText("Saída 2 · Falha")).toHaveClass("tool-exit-fail")
  for (const button of screen.getAllByText("Resultado")) fireEvent.click(button)
  await waitFor(() =>
    expect(view.container.querySelector('[data-call-id="ok"] .tool-output code')).toHaveAttribute(
      "data-highlighted",
      "true",
    ),
  )
  expect(view.container.querySelector('[data-call-id="ok"] .tool-output code')?.textContent).toBe(
    '{\n  "ok": true,\n  "total": 2\n}',
  )
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-call-id="diff"] .tool-output span[style*="--text-success"]'),
    ).not.toBeNull(),
  )
  expect(
    view.container.querySelector('[data-call-id="diff"] .tool-output span[style*="--text-danger"]'),
  ).toHaveTextContent("-antigo")
})

it("keeps the same code block mounted when its parent re-renders so the copy confirmation survives", async () => {
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  const source = "```ts\nconst ready = true\n```"
  const view = render(<MarkdownContent content={source} />)
  const button = await screen.findByRole("button", { name: "Copiar código" })
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveTextContent("Copiado"))
  view.rerender(<MarkdownContent content={source} />)
  view.rerender(<MarkdownContent content={source} compact />)
  expect(button.isConnected).toBe(true)
  expect(screen.getByRole("button", { name: "Copiar código" })).toBe(button)
  expect(button).toHaveTextContent("Copiado")
})
