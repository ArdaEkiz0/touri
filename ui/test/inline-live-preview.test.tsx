import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Bot, MachineState, ToolCallPart } from "@touri/contracts"
import { afterEach, expect, test, vi } from "vitest"
import type { UiApi } from "../src/api/client"
import { InlineLivePreview, InlinePreviewContext } from "../src/features/desktop/InlineLivePreview"
import {
  readInlinePreviewPreference,
  setInlinePreviewPreference,
} from "../src/features/desktop/inlinePreviewPreference"

const source = vi.hoisted(() => ({
  starts: vi.fn(),
  stops: vi.fn(),
  frames: [] as Array<(frame: { src: string; title: string; url: string }) => void>,
}))
vi.mock("../src/features/desktop/inlineFrameSource", () => ({
  startInlineFrameSource: (...args: unknown[]) => {
    source.starts(...args)
    source.frames.push(args[3] as (typeof source.frames)[number])
    return source.stops
  },
}))
const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
const tool: ToolCallPart = {
  type: "tool_call",
  tool: "mcp__touri__browser_open",
  callId: "open",
  inputJson: '{"url":"https://example.org"}',
  outputJson: null,
  summary: "MCP tool call",
  ok: null,
}
const api = { isMock: false } as UiApi
const bot = { id: "bot", name: "Bot", machine: "vm" } as Bot
const machine = { botId: "bot", status: "running" } as MachineState
const setup = (running = true, state = machine) => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (typeof observers)[number]) {
        observers.push(callback)
      }
      observe() {}
      disconnect() {}
    },
  )
  const open = vi.fn()
  const tree = (live: boolean, state: MachineState) => (
    <InlinePreviewContext.Provider
      value={{ api, bot, machine: state, activeCallId: live ? "open" : undefined, onOpenComputer: open }}
    >
      <InlineLivePreview parts={[live ? tool : { ...tool, ok: true }]} finished={!live} />
    </InlinePreviewContext.Provider>
  )
  return { ...render(tree(running, state)), tree, open }
}
const visible = (value: boolean, index = 0) => act(() => observers[index]?.([{ isIntersecting: value }]))
afterEach(() => {
  cleanup()
  observers.splice(0)
  source.frames.splice(0)
  localStorage.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

test("starts only on screen, expands without input and freezes the last frame as a CSP-allowed data: image", () => {
  const view = setup()
  expect(source.starts).not.toHaveBeenCalled()
  visible(true)
  expect(source.starts).toHaveBeenCalledTimes(1)
  act(() =>
    source.frames[0]?.({ src: "data:image/jpeg;base64,AAAA", title: "Página atual", url: "https://example.org" }),
  )
  expect(screen.getByText("Página atual")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "Expandir" }))
  expect(screen.getByRole("region", { name: "Prévia do computador no chat" })).toHaveClass(
    "inline-live-preview-expanded",
  )
  fireEvent.click(screen.getByRole("button", { name: "Abrir no Computador" }))
  expect(view.open).toHaveBeenCalledOnce()
  act(() =>
    source.frames[0]?.({ src: "data:image/jpeg;base64,BBBB", title: "Nova página", url: "https://example.org/new" }),
  )
  // The desktop CSP allows data: images only; a blob: URL renders as a broken image in the app.
  expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/jpeg;base64,BBBB")
  view.rerender(view.tree(false, machine))
  expect(source.stops).toHaveBeenCalledOnce()
  expect(screen.getByText("Última imagem")).toBeVisible()
  expect(screen.getByRole("img")).toBeVisible()
  expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/jpeg;base64,BBBB")
  view.unmount()
})

test("pauses off screen and while hidden, and resumes on return", () => {
  setup()
  visible(true)
  visible(false)
  expect(source.stops).toHaveBeenCalledTimes(1)
  visible(true)
  expect(source.starts).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, "hidden", { configurable: true, value: true })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
  expect(source.stops).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
  expect(source.starts).toHaveBeenCalledTimes(3)
})

test("never observes a stopped VM or completed historical call", () => {
  setup(true, { ...machine, status: "stopped" })
  visible(true)
  expect(source.starts).not.toHaveBeenCalled()
  cleanup()
  observers.splice(0)
  setup(false)
  visible(true)
  expect(source.starts).not.toHaveBeenCalled()
})

test("preference defaults on and turning it off stops the stream", () => {
  expect(readInlinePreviewPreference()).toBe(true)
  setup()
  visible(true)
  act(() => setInlinePreviewPreference(false))
  expect(source.stops).toHaveBeenCalledOnce()
  expect(readInlinePreviewPreference()).toBe(false)
  expect(screen.queryByRole("region", { name: "Prévia do computador no chat" })).toBeNull()
})

test("caps to one live source per window and frees the slot", () => {
  const first = setup()
  const second = setup()
  visible(true)
  visible(true, 1)
  expect(source.starts).toHaveBeenCalledTimes(1)
  first.unmount()
  expect(source.stops).toHaveBeenCalledTimes(1)
  expect(source.starts).toHaveBeenCalledTimes(2)
  second.unmount()
})
