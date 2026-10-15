import { fireEvent } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import type { TauriInvoke, UiApi } from "../src/api/client"
import { computerKillSwitchEvent, installComputerKillSwitch } from "../src/computerKillSwitch"

const { native } = vi.hoisted(() => ({ native: { listener: undefined as (() => void) | undefined, stop: vi.fn() } }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, listener) => {
    native.listener = listener
    return native.stop
  }),
}))

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
  native.listener = undefined
  vi.clearAllMocks()
})

test("the foreground shortcut invokes the native kill so host input stops as well", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  const request = vi.fn()
  const invoke = vi.fn(async () => ({}))
  const revoked = vi.fn()
  window.addEventListener(computerKillSwitchEvent, revoked)
  const stop = installComputerKillSwitch({ request } as unknown as UiApi, invoke as TauriInvoke)
  try {
    await Promise.resolve()
    fireEvent.keyDown(window, { key: ".", code: "Period", ctrlKey: true, altKey: true, metaKey: true })
    expect(invoke).toHaveBeenCalledWith("computer_kill_switch", {})
    expect(request).not.toHaveBeenCalled()
    expect(revoked).toHaveBeenCalledOnce()
    native.listener?.()
    expect(revoked).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: ".", code: "Period", ctrlKey: true, altKey: true, metaKey: true, repeat: true })
    expect(invoke).toHaveBeenCalledOnce()
  } finally {
    stop()
    window.removeEventListener(computerKillSwitchEvent, revoked)
  }
  expect(native.stop).toHaveBeenCalledOnce()
})

test("a failed native notification still revokes the sidecar viewers", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  const error = new Error("bridge unavailable")
  const invoke = vi.fn(async () => {
    throw error
  })
  const request = vi.fn(async () => ({ revoked: 1 }))
  const notice = vi.fn()
  const stop = installComputerKillSwitch({ request } as unknown as UiApi, invoke as TauriInvoke, notice)
  try {
    fireEvent.keyDown(window, { key: ".", code: "Period", ctrlKey: true, altKey: true, metaKey: true })
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("POST /computer/kill", {}))
    expect(notice).toHaveBeenCalledWith(error)
  } finally {
    stop()
  }
})
