import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { BrowserTabInfo } from "@touri/contracts"
import { afterEach, expect, test, vi } from "vitest"
import type { ApiRequest } from "../src/api/client"
import { createMockApi } from "../src/api/mock"
import { BrowserPanel } from "../src/components/RightPanels"
import { ApiError } from "../src/errors"

afterEach(cleanup)

const tab = {
  tabId: "guest-page",
  ownerBotId: "vm-bot",
  title: "Página na VM",
  url: "https://example.test/",
  state: "live",
  heldByUser: false,
  openerTabId: null,
  lastUsedAt: 1,
} satisfies BrowserTabInfo & { ownerBotId: string }

test("a failed takeover shows the real cause and the button becomes usable again", async () => {
  const api = createMockApi()
  const request = vi.fn(async (route: string) => {
    if (route === "POST /browser/tabs/:id/takeover")
      throw new ApiError(404, "Não foi possível assumir a aba: o navegador da máquina não respondeu.")
    return { tabs: [tab] }
  })
  api.request = request as ApiRequest
  const notices: string[] = []
  render(<BrowserPanel api={api} botId="vm-bot" tabs={[]} onNotice={(message) => notices.push(message)} />)
  await waitFor(() => expect(screen.getByText(tab.url)).toBeInTheDocument())
  const button = screen.getByRole("button", { name: /Assumir|Take over/ })
  fireEvent.click(button)
  await waitFor(() => expect(notices).toHaveLength(1))
  expect(notices[0]).toContain("o navegador da máquina não respondeu")
  await waitFor(() => expect(screen.getByRole("button", { name: /Assumir|Take over/ })).toBeEnabled())
})
