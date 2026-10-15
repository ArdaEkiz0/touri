import { readFileSync } from "node:fs"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ApiRoutes } from "@touri/contracts"
import { afterEach, expect, it, vi } from "vitest"
import type { ApiRequest } from "../src/api/client"
import { createMockApi } from "../src/api/mock"
import { ProviderLogin } from "../src/components/ProviderLogin"

afterEach(cleanup)

const missing: ApiRoutes["GET /bots/:id/provider-login"]["res"] = {
  provider: "claude",
  ready: false,
  source: "missing",
  configuredSource: "vault",
  health: "not-found",
  message: "Login ausente",
}
const ready = {
  ...missing,
  ready: true,
  source: "token" as const,
  health: "ready" as const,
  message: "Login disponível",
}
const transport = {
  ...missing,
  health: "transport" as const,
  message: "O cofre de segredos não respondeu. Tente novamente.",
}
const fixture = (request: ApiRequest) => {
  const configured = vi.fn()
  render(
    <ProviderLogin
      api={{ ...createMockApi(), request }}
      botId="login-test"
      provider="claude"
      onConfigured={configured}
    />,
  )
  return configured
}
const save = () => {
  fireEvent.click(screen.getByRole("button", { name: "Entrar no Claude nesta máquina" }))
  fireEvent.change(screen.getByLabelText("Token OAuth do Claude"), { target: { value: "fixture-oauth-token" } })
  fireEvent.click(screen.getByRole("button", { name: "Salvar login no cofre" }))
}

it("shows the route's transport message and retries the check without stale errors", async () => {
  const request = vi.fn().mockResolvedValueOnce(transport).mockResolvedValue(ready)
  fixture(request as ApiRequest)
  expect(await screen.findByRole("status")).toHaveTextContent(transport.message)
  fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }))
  await screen.findByText(ready.message)
  expect(request).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull()
})

it("recovers from a failed HTTP check and clears its error on retry", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("connection closed")).mockResolvedValue(ready)
  fixture(request as ApiRequest)
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível verificar o login.")
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }))
  await screen.findByText(ready.message)
  expect(screen.queryByRole("alert")).toBeNull()
})

it("keeps a failed save distinct from a failed check and lets the user retry the save", async () => {
  let writes = 0
  const request = vi.fn(async (route: string) => {
    if (route === "GET /bots/:id/provider-login") return writes > 1 ? ready : missing
    if (++writes === 1) throw new Error("vault unavailable")
    return {}
  })
  const configured = fixture(request as ApiRequest)
  await screen.findByText(missing.message)
  save()
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar o login no cofre de segredos.")
  expect(screen.getByLabelText("Token OAuth do Claude")).toHaveValue("fixture-oauth-token")
  expect(configured).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }))
  await screen.findByText(ready.message)
  expect(writes).toBe(2)
  expect(configured).toHaveBeenCalledOnce()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByLabelText("Token OAuth do Claude")).toBeNull()
})

it("shows a post-save check failure as a check failure without saving again on retry", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(missing)
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("connection closed"))
    .mockResolvedValue(ready)
  const configured = fixture(request as ApiRequest)
  await screen.findByText(missing.message)
  save()
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível verificar o login.")
  expect(configured).toHaveBeenCalledOnce()
  expect(screen.queryByLabelText("Token OAuth do Claude")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }))
  await screen.findByText(ready.message)
  expect(request.mock.calls.filter(([route]) => route === "PUT /bots/:id/provider-login")).toHaveLength(1)
})

it("preserves the route's transport message after a successful save and retries only the check", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(missing)
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(transport)
    .mockResolvedValue(ready)
  const configured = fixture(request as ApiRequest)
  await screen.findByText(missing.message)
  save()
  await screen.findByText(transport.message)
  expect(configured).toHaveBeenCalledOnce()
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByLabelText("Token OAuth do Claude")).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }))
  await screen.findByText(ready.message)
  expect(request.mock.calls.filter(([route]) => route === "PUT /bots/:id/provider-login")).toHaveLength(1)
})

it("spaces the save actions and failure line using the provider login styles", async () => {
  const style = document.createElement("style")
  style.textContent =
    readFileSync("src/styles.css", "utf8")
      .match(/\.provider-login[^}]*\}/g)
      ?.join("\n") ?? ""
  document.head.append(style)
  try {
    const request = vi.fn().mockResolvedValueOnce(missing).mockRejectedValue(new Error("vault unavailable"))
    fixture(request as ApiRequest)
    await screen.findByText(missing.message)
    save()
    const error = await screen.findByRole("alert")
    const actions = screen.getByRole("button", { name: "Salvar login no cofre" }).parentElement as HTMLElement
    expect(getComputedStyle(actions).display).toBe("flex")
    expect(getComputedStyle(actions).gap).toBe("var(--space-8)")
    expect(getComputedStyle(actions).marginTop).toBe("var(--space-12)")
    const section = screen.getByRole("region", { name: "Login do provedor nesta máquina" })
    expect(getComputedStyle(section).display).toBe("grid")
    expect(getComputedStyle(section).gap).toBe("var(--space-12)")
    expect(getComputedStyle(error).marginTop).toBe("0px")
  } finally {
    style.remove()
  }
})
