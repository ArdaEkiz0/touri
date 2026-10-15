import type { Kernel, RouteModule, VmRuntime } from "@touri/contracts"
import { errorResponse } from "../kernel/errors"
import { MachineServiceError } from "./service-error"
import { VmStageError } from "./stage"

export const machineActionRoutes = (kernel: Kernel, runtime: VmRuntime): RouteModule["routes"] => [
  {
    method: "POST",
    path: "/machines/service/start",
    handler: async ({ body }) => {
      const botId = (body as { botId?: unknown } | null)?.botId
      if (botId !== undefined && (typeof botId !== "string" || !botId))
        return { status: 400, json: { errorCode: "INVALID_ARGS" } }
      if (typeof botId === "string" && kernel.services.use("store.api")?.getBot({ botId })?.machine === "local")
        return { status: 404, json: { errorCode: "NOT_FOUND" } }
      try {
        return {
          status: 200,
          json: { machine: await runtime.startService({ ...(typeof botId === "string" ? { botId } : {}) }) },
        }
      } catch (error) {
        if (error instanceof VmStageError)
          return { status: error.errorCode === "timeout" ? 504 : 499, json: { errorCode: error.errorCode } }
        return errorResponse(error)
      }
    },
  },
  {
    method: "POST",
    path: "/bots/:id/machine/stop",
    handler: async ({ params }) => {
      const botId = params.id ?? ""
      if (kernel.services.use("store.api")?.getBot({ botId })?.machine === "local")
        return { status: 404, json: { errorCode: "NOT_FOUND" } }
      try {
        await kernel.services.use("runtime.cancelBotTurns")?.({ botId })
        await kernel.services.use("vm.desktop")?.closeBot(botId)
        await runtime.stop({ botId })
        return { status: 200, json: { machine: runtime.states().find((state) => state.botId === botId) } }
      } catch (error) {
        return errorResponse(error)
      }
    },
  },
  {
    method: "POST",
    path: "/bots/:id/machine/intent",
    handler: async ({ params, body }) => {
      const intent = (body as { intent?: unknown } | null)?.intent
      if (
        ![
          "composer-focus",
          "composer-typing",
          "computer-open",
          "computer-visible",
          "computer-hidden",
          "foreground",
          "background",
          "idle",
        ].includes(String(intent))
      )
        return { status: 400, json: { errorCode: "INVALID_INTENT", error: "Intenção da máquina inválida" } }
      const viewerId = (body as { viewerId?: unknown } | null)?.viewerId
      if (
        (intent === "computer-visible" || intent === "computer-hidden") &&
        (typeof viewerId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(viewerId))
      )
        return { status: 400, json: { errorCode: "INVALID_ARGS" } }
      try {
        return {
          status: 200,
          json: {
            machine: await runtime.intent({
              botId: params.id ?? "",
              intent: intent as import("@touri/contracts").MachineIntent,
              ...(typeof viewerId === "string" ? { viewerId } : {}),
            }),
          },
        }
      } catch (error) {
        if (error instanceof MachineServiceError) return errorResponse(error)
        return { status: 409, json: { errorCode: "MACHINE_ERROR", error: kernel.redact(String(error)) } }
      }
    },
  },
  ...(["restart", "reset"] as const).map((action): RouteModule["routes"][number] => ({
    method: "POST",
    path: `/bots/:id/machine/${action}`,
    handler: async ({ params, body }) => {
      const input = body as { confirm?: boolean; stopTurns?: boolean; projectId?: string | null } | null
      if (action === "reset" && input?.confirm !== true)
        return {
          status: 400,
          json: { errorCode: "CONFIRM_REQUIRED", error: "Confirme a remoção de todos os dados da máquina" },
        }
      try {
        if (input?.stopTurns === true) {
          const cancel = kernel.services.use("runtime.cancelBotTurns")
          if (!cancel) throw new Error("Não foi possível parar os turnos. O serviço ainda está iniciando.")
          await cancel({ botId: params.id ?? "" })
        }
        return {
          status: 200,
          json: {
            machine: await runtime.restart({
              botId: params.id ?? "",
              reset: action === "reset",
              ...(input?.projectId !== undefined ? { projectId: input.projectId } : {}),
            }),
          },
        }
      } catch (error) {
        if (error instanceof MachineServiceError) return errorResponse(error)
        return {
          status: 409,
          json: {
            errorCode: "MACHINE_ERROR",
            error: kernel.redact(error instanceof Error ? error.message : String(error)),
          },
        }
      }
    },
  })),
]
