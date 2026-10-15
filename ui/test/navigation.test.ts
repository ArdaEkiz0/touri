import { afterEach, expect, test, vi } from "vitest"
import { navigatePage } from "../src/design/navigation"
import type { AppRoute } from "../src/workspaceState"

const chat: AppRoute = { section: "bots", screen: "chat" }
const preview: AppRoute = { section: "bots", screen: "preview" }
const deferred = () => {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (document as unknown as Record<string, unknown>).startViewTransition
  delete document.documentElement.dataset.pageTransition
})

test("same-page updates and reduced motion commit directly without snapshots", () => {
  const start = vi.fn()
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start })
  const commit = vi.fn()
  navigatePage(chat, chat, commit)
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList)
  navigatePage(chat, preview, commit)
  expect(start).not.toHaveBeenCalled()
  expect(commit.mock.calls).toEqual([[chat], [preview]])
})

test("a newer navigation supersedes a pending snapshot, and reduced motion skips an active one", async () => {
  const media = new EventTarget() as EventTarget & { matches: boolean }
  media.matches = false
  vi.spyOn(window, "matchMedia").mockReturnValue(media as MediaQueryList)
  const callbacks: Array<() => void> = []
  const firstDone = deferred()
  const done = deferred()
  const skip = vi.fn()
  const firstSkip = vi.fn()
  const transitions = [
    { ready: Promise.reject(new Error("Skipped snapshot")), finished: firstDone.promise, skipTransition: firstSkip },
    { ready: Promise.resolve(), finished: done.promise, skipTransition: skip },
  ]
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: (callback: () => void) => {
      callbacks.push(callback)
      return transitions[callbacks.length - 1]
    },
  })
  const commit = vi.fn()
  navigatePage(chat, preview, commit)
  expect(document.documentElement.dataset.pageTransition).toBe("active")
  expect(document.documentElement.style.getPropertyValue("--page-step")).toBe("1")
  navigatePage(chat, chat, commit)
  callbacks[0]?.()
  expect(firstSkip).toHaveBeenCalledOnce()
  expect(commit.mock.calls).toEqual([[chat]])
  firstDone.resolve()
  await firstDone.promise
  navigatePage(preview, chat, commit)
  callbacks[1]?.()
  expect(document.documentElement.style.getPropertyValue("--page-step")).toBe("-1")
  media.matches = true
  media.dispatchEvent(new Event("change"))
  expect(skip).toHaveBeenCalledOnce()
  done.resolve()
  await done.promise
  expect(document.documentElement.dataset.pageTransition).toBeUndefined()
  const calls = skip.mock.calls.length
  media.dispatchEvent(new Event("change"))
  expect(skip.mock.calls.length).toBe(calls)
})
