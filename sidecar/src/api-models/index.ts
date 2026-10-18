import {
  type ApiModel,
  apiModelErrors,
  apiModelPresets,
  type Kernel,
  type RouteModule,
  type RouteResponse,
} from "@touri/contracts"
import { withDeadline } from "../kernel/policy"
import { buildChildEnv } from "../kernel/shell-env"
import { openCodeBinary } from "../runtime/opencode/config"
import { getApiConnection, getDiscoveredModels, isApiCompletion, requestApi } from "./client"
import { deleteApiModel, getApiModelAccount, getApiModels, isApiModelId, saveApiModel } from "./config"

export const name = "api-models"
const json = (status: number, value: unknown): RouteResponse => ({ status, json: value })
const failure = (reason: keyof typeof apiModelErrors, status = 400): RouteResponse =>
  json(status, { reason, errorCode: `api_model_${reason}`, error: apiModelErrors[reason] })

export const getApiModelKey = async (kernel: Kernel, id: string, signal?: AbortSignal): Promise<string | null> => {
  const result = await withDeadline({
    operation: () => kernel.callHost("keychain.get", { account: getApiModelAccount(id) }),
    timeoutMs: 5000,
    signal: signal ?? AbortSignal.timeout(5000),
  })
  if (!result.success) throw new Error(apiModelErrors.secret_unavailable)
  const key = result.value.value
  if (key) kernel.addRedactionValue(key)
  return key
}

export const createApiModels = (kernel: Kernel, fetchImpl = fetch): RouteModule => {
  const connection = (input: unknown) => {
    const value = getApiConnection(input)
    if (value) kernel.addRedactionValue(value.apiKey)
    return value
  }
  const test = async (body: unknown): Promise<RouteResponse> => {
    const config = connection(body)
    const modelId = body && typeof body === "object" && "modelId" in body ? body.modelId : null
    if (!config || !isApiModelId(modelId)) return json(200, { ok: false, reason: "invalid_settings" })
    const result = await requestApi({ connection: config, modelId, fetchImpl })
    if ("reason" in result) return json(200, { ok: false, reason: result.reason })
    return json(200, isApiCompletion(result.value) ? { ok: true } : { ok: false, reason: "invalid_response" })
  }
  return {
    name,
    routes: [
      {
        method: "GET",
        path: "/api-models",
        handler: async () =>
          json(200, {
            models: getApiModels(kernel),
            executorAvailable: openCodeBinary(buildChildEnv({ base: await kernel.shellEnv() })).success,
          }),
      },
      {
        method: "POST",
        path: "/api-models/models",
        handler: async ({ body }) => {
          const config = connection(body)
          if (!config) return json(200, { models: [], reason: "invalid_settings" })
          const result = await requestApi({ connection: config, fetchImpl })
          if ("reason" in result) return json(200, { models: [], reason: result.reason })
          const models = getDiscoveredModels(result.value)
          return json(
            200,
            models
              ? { models: models.filter((model) => !model.includes(config.apiKey)) }
              : { models: [], reason: "invalid_response" },
          )
        },
      },
      { method: "POST", path: "/api-models/test", handler: async ({ body }) => test(body) },
      {
        method: "POST",
        path: "/api-models",
        handler: async ({ body }) => {
          const config = connection(body)
          const row = body as Record<string, unknown> | null
          if (!config || !isApiModelId(row?.modelId)) return failure("invalid_settings")
          const name =
            row?.name === undefined ? apiModelPresets.find((item) => item.id === config.preset)?.name : row.name
          if (
            typeof name !== "string" ||
            !name.trim() ||
            name.length > 80 ||
            /[\p{Cc}{}]/u.test(name) ||
            name.includes(config.apiKey) ||
            row.modelId.includes(config.apiKey)
          )
            return failure("invalid_settings")
          const model: ApiModel = {
            id: kernel.newId(),
            preset: config.preset,
            name: name.trim(),
            baseUrl: config.baseUrl ?? "",
            modelId: row.modelId,
          }
          try {
            const saved = await withDeadline({
              operation: () =>
                kernel.callHost("keychain.set", { account: getApiModelAccount(model.id), value: config.apiKey }),
              timeoutMs: 5000,
            })
            if (!saved.success) return failure("secret_unavailable", 503)
          } catch {
            return failure("secret_unavailable", 503)
          }
          try {
            saveApiModel(kernel, model)
          } catch {
            await kernel.callHost("keychain.delete", { account: getApiModelAccount(model.id) }).catch(() => {})
            return failure("secret_unavailable", 503)
          }
          return json(201, { model })
        },
      },
      {
        method: "POST",
        path: "/api-models/:id/test",
        handler: async ({ params }) => {
          const model = getApiModels(kernel).find((candidate) => candidate.id === params.id)
          if (!model) return json(200, { ok: false, reason: "removed" })
          try {
            const key = await getApiModelKey(kernel, model.id)
            if (!key) return json(200, { ok: false, reason: "invalid_key" })
            return test({ preset: model.preset, baseUrl: model.baseUrl, modelId: model.modelId, apiKey: key })
          } catch {
            return json(200, { ok: false, reason: "secret_unavailable" })
          }
        },
      },
      {
        method: "DELETE",
        path: "/api-models/:id",
        handler: async ({ params }) => {
          const model = getApiModels(kernel).find((candidate) => candidate.id === params.id)
          if (!model) return json(200, {})
          try {
            const result = await withDeadline({
              operation: () => kernel.callHost("keychain.delete", { account: getApiModelAccount(model.id) }),
              timeoutMs: 5000,
            })
            if (!result.success) return failure("secret_unavailable", 503)
          } catch {
            return failure("secret_unavailable", 503)
          }
          deleteApiModel(kernel, model.id)
          return json(200, {})
        },
      },
    ],
  }
}

export const init = async (kernel: Kernel): Promise<void> => {
  kernel.registerRoutes(createApiModels(kernel))
}
