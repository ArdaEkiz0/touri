import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import type { Bot } from "@touri/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMockApi } from "../src/api/mock"
import { ChatPanel } from "../src/components/ChatPanel"
import { useComposerMachineIntent, useComputerPresence, useMachineParking } from "../src/machineIntents"

const nativeFocus = vi.hoisted(() => ({ subscribe: vi.fn() }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onFocusChanged: nativeFocus.subscribe }) }))

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  nativeFocus.subscribe.mockReset()
})

const fixture = () => {
  const api = createMockApi()
  const bot = api.getState().bots[0]
  if (!bot) throw new Error("Missing mock bot")
  return { api, bot: { ...bot, machine: "vm" as const, machineIdleMinutes: 1 } }
}
const intents = (api: ReturnType<typeof createMockApi>) =>
  api.calls.filter((call) => call.route === "POST /bots/:id/machine/intent")

describe("VM composer intents", () => {
  it("focus and typing send intents through the real conversation textarea, without sending a message", async () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    const thread = api.getState().threads.find((item) => item.botId === bot.id) ?? null
    render(
      <ChatPanel
        api={api}
        bot={bot}
        thread={thread}
        messages={[]}
        runs={[]}
        onSend={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
        onSwitchBranch={vi.fn()}
        computerGrant={null}
        onComputerGrant={vi.fn()}
        onOpenTools={vi.fn()}
      />,
    )
    const composer = screen.getByRole("textbox", { name: `Mensagem para ${bot.name}` })
    fireEvent.focus(composer)
    fireEvent.change(composer, { target: { value: "Olá" } })
    expect(intents(api)).toHaveLength(1)
    expect(intents(api)[0]).toMatchObject({ input: { intent: "composer-focus" }, pathValues: { id: bot.id } })
    await act(async () => {})
    act(() => vi.advanceTimersByTime(5000))
    fireEvent.change(composer, { target: { value: "Olá, bot" } })
    expect(intents(api)[1]?.input).toEqual({ intent: "composer-typing" })
    expect(api.calls.some((call) => call.route.includes("/messages"))).toBe(false)
  })

  it("ignores local/paused bots, throttles typing, and retries a rejected warm request", async () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    const { result, rerender } = renderHook(
      ({ selected }: { selected: Bot }) => useComposerMachineIntent(api, selected),
      { initialProps: { selected: { ...bot, machine: "local" } as Bot } },
    )
    act(() => result.current("composer-focus"))
    expect(intents(api)).toHaveLength(0)
    rerender({ selected: { ...bot, paused: true } })
    act(() => result.current("composer-focus"))
    expect(intents(api)).toHaveLength(0)
    rerender({ selected: bot })
    const original = api.request
    vi.spyOn(api, "request").mockRejectedValueOnce(new Error("Offline"))
    await act(async () => result.current("composer-focus"))
    api.request = original
    act(() => {
      result.current("composer-typing")
      result.current("composer-typing")
    })
    expect(intents(api)).toHaveLength(1)
  })

  it("debounces focus and typing per bot and keeps one pending wake across bot changes and blur", async () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    let finish: (value: object) => void = () => {}
    const request = vi.spyOn(api, "request").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { result, rerender } = renderHook(({ selected }) => useComposerMachineIntent(api, selected), {
      initialProps: { selected: bot },
    })
    act(() => {
      result.current("composer-focus")
      result.current("composer-focus")
      fireEvent(window, new Event("blur"))
      vi.advanceTimersByTime(10_000)
      result.current("composer-typing")
    })
    expect(request).toHaveBeenCalledTimes(1)
    rerender({ selected: { ...bot, id: "second" } })
    await act(async () => result.current("composer-focus"))
    rerender({ selected: bot })
    act(() => result.current("composer-focus"))
    expect(request).toHaveBeenCalledTimes(2)
    await act(async () => finish({}))
    await act(async () => result.current("composer-typing"))
    act(() => result.current("composer-focus"))
    expect(request).toHaveBeenCalledTimes(3)
    expect(
      request.mock.calls.every(([, body]) => !["background", "idle"].includes((body as { intent: string }).intent)),
    ).toBe(true)
  })
})

describe("VM workspace parking", () => {
  it("window blur and APP_BACKGROUND do not request a park and clean up listeners", () => {
    const { api, bot } = fixture()
    const { unmount } = renderHook(() => useMachineParking(api, [bot, { ...bot, id: "local", machine: "local" }], true))
    fireEvent(window, new Event("blur"))
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    fireEvent(document, new Event("visibilitychange"))
    expect(intents(api)).toHaveLength(0)
    unmount()
    fireEvent(window, new Event("focus"))
    fireEvent(window, new Event("blur"))
    expect(intents(api)).toHaveLength(0)
  })

  it("activity resets each bot's idle deadline; disabled workspaces do not park", () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    const { rerender } = renderHook(
      ({ enabled }) => useMachineParking(api, [bot, { ...bot, id: "slow", machineIdleMinutes: 2 }], enabled),
      { initialProps: { enabled: false } },
    )
    act(() => vi.advanceTimersByTime(120_000))
    expect(intents(api)).toHaveLength(0)
    rerender({ enabled: true })
    act(() => vi.advanceTimersByTime(30_000))
    fireEvent(window, new Event("keydown"))
    act(() => vi.advanceTimersByTime(30_000))
    expect(intents(api)).toHaveLength(0)
    act(() => vi.advanceTimersByTime(30_000))
    expect(intents(api)).toHaveLength(1)
    expect(intents(api)[0]?.input).toEqual({ intent: "idle" })
    act(() => vi.advanceTimersByTime(60_000))
    expect(intents(api)).toHaveLength(2)
    expect(intents(api)[1]?.pathValues.id).toBe("slow")
  })

  it("blur does not escalate an earlier idle check into immediate parking", () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    renderHook(() => useMachineParking(api, [bot], true))
    act(() => vi.advanceTimersByTime(60_000))
    fireEvent(window, new Event("blur"))
    expect(intents(api).map((call) => call.input)).toEqual([{ intent: "idle" }])
  })

  it("hidden activity does not reset idle, and focus rearms the configured deadline", () => {
    vi.useFakeTimers()
    const { api, bot } = fixture()
    renderHook(() => useMachineParking(api, [bot], true))
    fireEvent(window, new Event("blur"))
    fireEvent(window, new Event("input"))
    act(() => vi.advanceTimersByTime(120_000))
    expect(intents(api).map((call) => call.input)).toEqual([{ intent: "idle" }])
    fireEvent(window, new Event("focus"))
    expect(intents(api).at(-1)?.input).toEqual({ intent: "foreground" })
  })

  it("native Tauri focus loss honors idle time, including bots loaded while away", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("__TAURI_INTERNALS__", {})
    const { api, bot } = fixture()
    let focus: (event: { payload: boolean }) => void = () => {}
    const cleanup = vi.fn()
    nativeFocus.subscribe.mockImplementation((callback) => {
      focus = callback
      return Promise.resolve(cleanup)
    })
    const { rerender, unmount } = renderHook(({ bots }) => useMachineParking(api, bots, true), {
      initialProps: { bots: [bot] },
    })
    await act(async () => {})
    act(() => focus({ payload: false }))
    expect(intents(api)).toHaveLength(0)
    rerender({ bots: [bot, { ...bot, id: "new-bot" }] })
    act(() => vi.advanceTimersByTime(30_000))
    expect(intents(api)).toHaveLength(0)
    act(() => vi.advanceTimersByTime(30_000))
    expect(intents(api).map((call) => call.input)).toEqual([{ intent: "idle" }, { intent: "idle" }])
    act(() => focus({ payload: true }))
    expect(
      intents(api)
        .slice(2, 4)
        .map((call) => call.input),
    ).toEqual([{ intent: "foreground" }, { intent: "foreground" }])
    act(() => vi.advanceTimersByTime(60_000))
    expect(
      intents(api)
        .slice(4)
        .map((call) => call.input),
    ).toEqual([{ intent: "idle" }, { intent: "idle" }])
    unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("removes a native subscription that finishes after the workspace unmounts", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {})
    const { api, bot } = fixture()
    let finish: (cleanup: () => void) => void = () => {}
    const cleanup = vi.fn()
    nativeFocus.subscribe.mockReturnValue(
      new Promise<() => void>((resolve) => {
        finish = resolve
      }),
    )
    const { unmount } = renderHook(() => useMachineParking(api, [bot], true))
    unmount()
    await act(async () => finish(cleanup))
    expect(cleanup).toHaveBeenCalledOnce()
  })
})

it("leases an open computer independently per window, renews while hidden and releases on close", async () => {
  vi.useFakeTimers()
  const { api, bot } = fixture()
  const one = renderHook(() => useComputerPresence(api, bot))
  const two = renderHook(() => useComputerPresence(api, bot))
  await act(async () => {})
  const first = intents(api)[0]?.input as { viewerId: string }
  const second = intents(api)[1]?.input as { viewerId: string }
  expect(first.viewerId).not.toBe(second.viewerId)
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
  fireEvent(window, new Event("blur"))
  act(() => vi.advanceTimersByTime(60_000))
  expect(intents(api).filter((call) => (call.input as { intent: string }).intent === "computer-visible")).toHaveLength(
    8,
  )
  one.unmount()
  expect(intents(api).at(-1)?.input).toEqual({ intent: "computer-hidden", viewerId: first.viewerId })
  two.unmount()
  expect(intents(api).at(-1)?.input).toEqual({ intent: "computer-hidden", viewerId: second.viewerId })
})

it("releases a presence request that finishes after unmount", async () => {
  const { api, bot } = fixture()
  let finish: (value: object) => void = () => {}
  const request = vi.spyOn(api, "request").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { unmount } = renderHook(() => useComputerPresence(api, bot))
  await act(async () => {})
  unmount()
  await act(async () => finish({}))
  expect(
    request.mock.calls.filter(([, body]) => (body as { intent: string }).intent === "computer-hidden"),
  ).toHaveLength(2)
})

it("keeps a presence socket across blur, reconnects on loss and closes it with the panel", async () => {
  vi.useFakeTimers()
  const { api, bot } = fixture()
  const sockets: Array<EventTarget & { url: string; close: ReturnType<typeof vi.fn> }> = []
  vi.stubGlobal(
    "WebSocket",
    class extends EventTarget {
      close = vi.fn()
      constructor(public url: string) {
        super()
        sockets.push(this)
      }
    },
  )
  api.isMock = false
  api.websocketUrl = (path) => `ws://sidecar${path}`
  const { unmount } = renderHook(() => useComputerPresence(api, bot))
  await act(async () => {})
  expect(sockets[0]?.url).toBe(`ws://sidecar/api/v1/bots/${bot.id}/machine/presence/socket`)
  fireEvent(window, new Event("blur"))
  expect(sockets[0]?.close).not.toHaveBeenCalled()
  act(() => sockets[0]?.dispatchEvent(new Event("close")))
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(sockets).toHaveLength(2)
  unmount()
  expect(sockets[1]?.close).toHaveBeenCalledOnce()
  act(() => vi.advanceTimersByTime(120_000))
  expect(sockets).toHaveLength(2)
  await act(async () => {})
})
