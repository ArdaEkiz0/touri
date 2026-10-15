import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { BrowserTabInfo } from "@touri/contracts"
import { afterEach, expect, test, vi } from "vitest"
import type { ApiRequest } from "../src/api/client"
import { createMockApi } from "../src/api/mock"
import { BrowserPanel } from "../src/components/RightPanels"

afterEach(cleanup)

test("Navegador fetches guest tabs for the selected bot instead of showing an empty cached snapshot", async () => {
  const api = createMockApi()
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
  const request = vi.fn(async () => ({ tabs: [tab] }))
  api.request = request as ApiRequest
  const view = render(<BrowserPanel api={api} botId="vm-bot" tabs={[]} onNotice={() => {}} />)
  await waitFor(() => expect(screen.getByText(tab.url)).toBeInTheDocument())
  expect(screen.queryByText("Nenhuma aba para este bot.")).toBeNull()
  expect(request).toHaveBeenCalledWith("GET /browser/tabs", { botId: "vm-bot" })
  view.rerender(<BrowserPanel api={api} botId="another" tabs={[]} onNotice={() => {}} />)
  expect(screen.queryByText(tab.url)).toBeNull()
})
