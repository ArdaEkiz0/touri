import { expect, test } from "vitest"
import { createApiClient } from "../src/api/client"
import { ApiError, userFacingError, userFacingRunError } from "../src/errors"

test("coded API errors render a Portuguese message and retain retry metadata", async () => {
  const api = createApiClient({
    endpoint: { baseUrl: "http://127.0.0.1:1", wsUrl: "ws://127.0.0.1:1", token: "test" },
    fetchImpl: async () =>
      Response.json({ errorCode: "RATE_LIMITED", code: "TOURI-E1006", error: "unsafe raw detail" }, { status: 429 }),
  })
  const error = await api.request("GET /health", {}).catch((value: unknown) => value)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({
    status: 429,
    errorCode: "RATE_LIMITED",
    code: "TOURI-E1006",
    retryable: true,
    domain: "kernel",
    origin: "rate-limit",
  })
  expect(userFacingError(error)).toBe("Muitas solicitações. Aguarde um pouco e tente novamente. [TOURI-E1006]")
  expect(userFacingError(error)).not.toContain("unsafe")
})

test("storage and provider errors display their public code without duplicating it", () => {
  const error = new ApiError(507, "detail [TOURI-E2002]", "TOURI-E2002")
  expect(error.message).toBe("Libere espaço no disco para salvar o arquivo. [TOURI-E2002]")
  expect(error.retryable).toBe(false)
  expect(new ApiError(401, "raw", "cli_auth", "TOURI-E3001").message).toContain("Entre na sua conta")
})

test("failed routine cards use the provider class and a friendly public code", () => {
  expect(userFacingRunError({ errorClass: "cli_auth" })).toBe(
    "Entre na sua conta do provedor para continuar. [TOURI-E3001]",
  )
  expect(userFacingRunError({ errorClass: "cli_crash" })).toContain("TOURI-E3002")
  expect(userFacingRunError({ errorClass: null })).toContain("TOURI-E1000")
})

test("an unavailable sidecar gives a coded friendly read error after one retry", async () => {
  let calls = 0
  const endpoint = { baseUrl: "http://127.0.0.1:1", wsUrl: "ws://127.0.0.1:1", token: "test" }
  const api = createApiClient({
    endpoint,
    resolveEndpoint: async () => endpoint,
    fetchImpl: async () => {
      calls += 1
      throw new TypeError("unsafe transport detail")
    },
  })
  const error = await api.request("GET /health", {}).catch((value: unknown) => value)
  expect(error).toMatchObject({ code: "TOURI-E1009", retryable: true, status: 0 })
  expect(userFacingError(error)).toContain("O serviço está indisponível")
  expect(userFacingError(error)).not.toContain("unsafe")
  expect(calls).toBe(2)
})
