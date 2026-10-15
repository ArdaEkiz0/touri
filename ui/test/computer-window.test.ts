import { afterEach, expect, test, vi } from "vitest"

const windows = vi.hoisted(() => ({
  created: [] as Array<{ label: string; options: Record<string, unknown>; setFocus: ReturnType<typeof vi.fn> }>,
}))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = vi.fn(async () => null)
    setFocus = vi.fn(async () => {})
    constructor(label: string, options: Record<string, unknown>) {
      windows.created.push({ label, options, setFocus: this.setFocus })
    }
    once(event: string, callback: () => void) {
      if (event === "tauri://created") queueMicrotask(callback)
      return Promise.resolve(() => {})
    }
  },
}))
afterEach(() => {
  windows.created.splice(0)
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__")
})

test("Abrir em janela opens the computer entry without credentials and brings it to the front", async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  const { openComputerWindow } = await import("../src/computerWindow")
  await openComputerWindow("01BOT/../x")
  const [created] = windows.created
  expect(created?.label).toBe("computer-01BOT----x")
  expect(created?.options).toMatchObject({ url: "index.html?computer=01BOT%2F..%2Fx", focus: true })
  expect(String(created?.options.url)).not.toMatch(/token|ticket/i)
  // An occluded window reports document.hidden; the viewer must still be in front of the user.
  expect(created?.setFocus).toHaveBeenCalledOnce()
})
