import type { Bot, Kernel, MachineState, VmRuntime } from "@touri/contracts"
import type { RemoteProvider } from "../vm/remote"
import { CloudError } from "./client"

/** Cloud runtime is a controller. It never starts a CLI, MCP server or scheduler on the Mac. */
export const createCloudRuntime = (
  kernel: Kernel,
  provider: RemoteProvider,
  input: {
    machine: (botId: string) => Promise<MachineState>
    id: (botId: string) => Promise<string>
    wake: (botId: string) => Promise<MachineState>
    park: (botId: string) => Promise<MachineState>
  },
) => {
  const states = new Map<string, MachineState>()
  const remember = (value: MachineState) => {
    states.set(value.botId, value)
    kernel.publish({ type: "machine.updated", machine: value })
    return value
  }
  const unsupported = (): never => {
    throw new CloudError("TOURI-E9009")
  }
  const service: VmRuntime = {
    capability: { available: true, reason: null, provider: "remote" },
    states: () => [...states.values()],
    intent: async ({ botId, intent }) => {
      if (intent === "computer-open") return remember(await input.wake(botId))
      const id = await input.id(botId)
      await provider.client.request("POST", `/v1/machines/${encodeURIComponent(id)}/intent`, { intent })
      return remember(await input.machine(botId))
    },
    holdViewer: () => () => {},
    acquire: async ({ botId }) => {
      if ((await input.machine(botId)).status !== "running") await input.wake(botId)
      return async () => {}
    },
    spawn: () => ({ success: false, errorCode: "SPAWN_FAILED", error: "O runtime inteiro deste bot roda na nuvem." }),
    exec: async ({ botId, ...options }) => provider.exec({ id: await input.id(botId), ...options }),
    writeFile: async ({ botId, path, content, signal }) => {
      await provider.client.request("PUT", `/v1/bots/${encodeURIComponent(botId)}/files`, { path, content }, signal)
    },
    prepareTurn: async () => {
      throw new CloudError("TOURI-E9014")
    },
    forwardPort: async ({ botId, guestPort }) => {
      const result = await provider.forwardPort({ id: await input.id(botId), guestPort })
      if (!result.success)
        throw new CloudError(
          result.errorCode.startsWith("TOURI-E9") ? (result.errorCode as "TOURI-E9000") : "TOURI-E9000",
        )
      if (!result.url) throw new CloudError("TOURI-E9000")
      return { hostPort: result.hostPort, url: result.url }
    },
    desktopConnection: async ({ botId, control }) => provider.openDesktop(await input.id(botId), control),
    browserEndpoint: async ({ botId }) => (await service.forwardPort({ botId, guestPort: 9222 })).url,
    computer: async () => ({
      success: false,
      errorCode: "TOURI-E9014",
      error: "Ferramentas do computador executam dentro do runtime remoto.",
    }),
    restart: async ({ botId, reset }) => {
      if (reset) unsupported()
      await input.park(botId)
      return remember(await input.wake(botId))
    },
    startService: async ({ botId }) => {
      await provider.client.capabilities()
      return botId ? remember(await input.wake(botId)) : null
    },
    stop: async ({ botId }) => {
      remember(await input.park(botId))
    },
    destroy: async ({ botId, deleteVolumes = true }) => {
      const id = await input.id(botId)
      // Protocol v1 machine deletion owns its volume. Require explicit deletion;
      // independent volume operations are unavailable on the sandbox server.
      if (!deleteVolumes) throw new CloudError("TOURI-E9009")
      const result = await provider.destroy({ id })
      if (!result.success) throw new CloudError("TOURI-E9000")
      await provider.client.request("DELETE", `/v1/bots/${encodeURIComponent(botId)}`, { confirm: true })
      states.delete(botId)
    },
    doctor: provider.doctor,
  }
  return { service, remember, dispose: () => provider.disconnect() }
}

export const routeVmRuntime = (kernel: Kernel, local: VmRuntime, cloud: VmRuntime): VmRuntime => {
  const target = (botId: string) =>
    kernel.services.use("store.api")?.getBot({ botId })?.machine === "cloud" ? cloud : local
  return {
    ...local,
    states: () => [...local.states(), ...cloud.states()],
    intent: (args) => target(args.botId).intent(args),
    acquire: (args) => target(args.botId).acquire(args),
    holdViewer: (id) => target(id).holdViewer?.(id) ?? (() => {}),
    spawn: (args) => target(args.botId).spawn(args),
    exec: (args) => target(args.botId).exec(args),
    writeFile: (args) => target(args.botId).writeFile(args),
    prepareTurn: (args) => target(args.botId).prepareTurn(args),
    forwardPort: (args) => target(args.botId).forwardPort(args),
    desktopConnection: (args) => target(args.botId).desktopConnection(args),
    browserEndpoint: (args) => target(args.botId).browserEndpoint(args),
    computer: (args) => target(args.ctx.botId).computer(args),
    restart: (args) => target(args.botId).restart(args),
    startService: (args) => (args.botId ? target(args.botId).startService(args) : local.startService(args)),
    stop: (args) => target(args.botId).stop(args),
    destroy: (args) => target(args.botId).destroy(args),
  }
}
export const cloudBotConfig = (bot: Bot) => ({
  id: bot.id,
  name: bot.name,
  provider: bot.provider,
  model: bot.model,
  instructions: bot.instructions,
  access: bot.access,
  approvals: bot.approvals,
  browserEnabled: bot.browserEnabled,
  computerUse: bot.computerUse,
  mainThreadId: bot.mainThreadId,
  auth: "byok-api" as const,
})
