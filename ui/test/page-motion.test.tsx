import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { PageTransition } from "../src/components/PageTransition"
import { AnimatedDisclosure } from "../src/components/Reveal"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("disclosures expose an accessible control and keep collapsed controls inert", () => {
  render(
    <AnimatedDisclosure className="tool-card" summary="1 chamada de ferramenta">
      <button type="button">Expandir resultado</button>
    </AnimatedDisclosure>,
  )
  const button = screen.getByRole("button", { name: "1 chamada de ferramenta" })
  const content = document.getElementById(button.getAttribute("aria-controls") ?? "")
  expect(content).toHaveAttribute("inert")
  expect(button).toHaveAttribute("aria-expanded", "false")
  fireEvent.click(button)
  expect(content).not.toHaveAttribute("inert")
  expect(button).toHaveAttribute("aria-expanded", "true")
  expect(content?.style.getPropertyValue("--reveal")).toBe("1")
  fireEvent.click(button)
  expect(content).toHaveAttribute("inert")
})

test("fallback push and pop use an inline direction variable, preserve content, and cancel on reduced motion", () => {
  const cancel = vi.fn()
  const animate = vi.fn((_keyframes: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel }))
  vi.stubGlobal("getComputedStyle", () => ({ direction: "rtl" }))
  const media = new EventTarget() as EventTarget & { matches: boolean }
  media.matches = false
  vi.spyOn(window, "matchMedia").mockReturnValue(media as MediaQueryList)
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate })
  const { rerender } = render(
    <PageTransition route={{ section: "bots", screen: "chat" }}>
      <input defaultValue="rascunho" />
    </PageTransition>,
  )
  rerender(
    <PageTransition route={{ section: "bots", screen: "preview" }}>
      <input defaultValue="rascunho" />
    </PageTransition>,
  )
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.calls[0]?.[0]).toEqual([
    { opacity: 0, transform: "translateX(calc(var(--inline-sign) * var(--page-step) * 24px))" },
    { opacity: 1, transform: "translateX(0)" },
  ])
  expect(document.querySelector(".workspace-page")).toHaveAttribute("data-navigation", "push")
  rerender(
    <PageTransition route={{ section: "bots", screen: "chat" }}>
      <input defaultValue="rascunho" />
    </PageTransition>,
  )
  expect(document.querySelector(".workspace-page")).toHaveAttribute("data-navigation", "pop")
  expect(screen.getByRole("textbox")).toHaveValue("rascunho")
  const calls = animate.mock.calls.length
  const canceled = cancel.mock.calls.length
  rerender(
    <PageTransition route={{ section: "bots", screen: "chat" }}>
      <input defaultValue="rascunho" />
    </PageTransition>,
  )
  expect(animate.mock.calls.length).toBe(calls)
  expect(cancel.mock.calls.length).toBe(canceled)
  media.matches = true
  media.dispatchEvent(new Event("change"))
  expect(cancel).toHaveBeenCalled()
  rerender(
    <PageTransition route={{ section: "bots", screen: "preview" }}>
      <input defaultValue="rascunho" />
    </PageTransition>,
  )
  expect(animate.mock.calls.length).toBe(calls)
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate
  vi.unstubAllGlobals()
})
