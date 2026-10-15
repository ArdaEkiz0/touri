import type { Kernel, RouteModule, RouteResponse } from "@touri/contracts"
import type { ComputerController } from "./controller"

type Body = Record<string, unknown>

const bodyRecord = (body: unknown): Body | null => (typeof body === "object" && body !== null ? (body as Body) : null)
const json = (status: number, value: unknown): RouteResponse => ({ status, json: value })
const error = (status: number, errorCode: string, message: string): RouteResponse =>
  json(status, { errorCode, error: message })

export const createComputerRoutes = ({
  kernel,
  controller,
}: {
  kernel: Kernel
  controller: ComputerController
}): RouteModule => ({
  name: "computer",
  routes: [
    {
      method: "POST",
      path: "/computer/grants",
      handler: async ({ body }) => {
        const input = bodyRecord(body)
        const botId = input?.botId
        const threadId = input?.threadId
        const minutes = input?.minutes
        if (typeof botId !== "string" || typeof threadId !== "string" || typeof minutes !== "number")
          return error(400, "INVALID_ARGS", "botId, threadId and minutes are required")
        const store = kernel.services.use("store.api")
        const bot = store?.getBot({ botId })
        const thread = store?.getThread({ threadId })
        if (store && (!bot || !thread || thread.botId !== botId))
          return error(404, "NOT_FOUND", "Bot or thread not found")
        const result = controller.grant({ botId, threadId, minutes })
        if (!result.success) return error(400, result.errorCode, result.error)
        return json(200, {
          grantId:
            result.structured &&
            typeof result.structured === "object" &&
            result.structured !== null &&
            "id" in result.structured
              ? result.structured.id
              : "",
          expiresAt:
            result.structured &&
            typeof result.structured === "object" &&
            result.structured !== null &&
            "expiresAt" in result.structured
              ? result.structured.expiresAt
              : 0,
        })
      },
    },
    {
      method: "POST",
      path: "/computer/kill",
      handler: async () => json(200, { revoked: controller.kill({ revokedBy: "user" }) }),
    },
  ],
})
