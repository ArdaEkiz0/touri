import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type { UiApi } from "../src/api/client"
import { BotNetworkSettings } from "../src/components/BotNetworkSettings"

afterEach(cleanup)
it("defaults LAN off, saves the selected permission and explains restart before loosening", async () => {
  const policy = { allowLan: false, resolvers: ["1.1.1.1", "8.8.8.8"], privateDomains: [] }
  const request = vi.fn(async (route: string, input: typeof policy) =>
    route.startsWith("PUT") ? { requested: input, active: policy } : { requested: policy, active: policy },
  )
  render(<BotNetworkSettings api={{ request } as unknown as UiApi} botId="bot" />)
  const toggle = screen.getByRole("switch", { name: "Permitir acesso à rede local" })
  await waitFor(() => expect(toggle).not.toBeDisabled())
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("PUT /bots/:id/network-policy", { ...policy, allowLan: true }, { id: "bot" }),
  )
  expect(await screen.findByRole("status")).toHaveTextContent("Reinicie a máquina")
  expect(toggle).toBeChecked()
})
it("tells users of machines created before the network policy how to regain LAN access", async () => {
  const policy = { allowLan: false, resolvers: ["1.1.1.1"], privateDomains: [] }
  const request = vi.fn(async () => ({ requested: policy, active: policy }))
  render(<BotNetworkSettings api={{ request } as unknown as UiApi} botId="bot" />)
  expect(screen.getByText(/criadas em versões anteriores também começam com a rede local bloqueada/)).toBeTruthy()
})
it("reports policy failures without claiming the permission was saved", async () => {
  const policy = { allowLan: false, resolvers: ["1.1.1.1"], privateDomains: [] }
  const request = vi.fn(async (route: string) => {
    if (route.startsWith("PUT")) throw new Error("failed")
    return { requested: policy, active: policy }
  })
  render(<BotNetworkSettings api={{ request } as unknown as UiApi} botId="bot" />)
  const toggle = screen.getByRole("switch")
  await waitFor(() => expect(toggle).not.toBeDisabled())
  fireEvent.click(toggle)
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar")
  expect(toggle).not.toBeChecked()
})
