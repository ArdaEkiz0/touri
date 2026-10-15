import type { Database } from "bun:sqlite"
import { hostname } from "node:os"
import type { ApprovalScope, Kernel, StandingGrant } from "@touri/contracts"

type BoundScope = ApprovalScope & { destination?: string }

const storedMachineId = (kernel: Kernel, botId: string): string | null => {
  const database = kernel.db as Database
  if (typeof database.query !== "function") return null
  const cloud = database.query("SELECT machine_id FROM cloud_machines WHERE bot_id = ?").get(botId) as {
    machine_id: string
  } | null
  if (cloud) return cloud.machine_id
  const local = database.query("SELECT vm_id FROM bot_machines WHERE bot_id = ?").get(botId) as {
    vm_id: string
  } | null

  return local?.vm_id ?? null
}

/**
 * Identity a standing grant is bound to. The guest identity is the machine, not the
 * boot: the sealed-connection key rotates on every start and a stopped machine has no
 * live connection, so neither may be part of a grant that must outlive a restart.
 */
export const approvalDestination = (kernel: Kernel, botId: string, source?: ApprovalScope["source"]): string => {
  const bot = kernel.services.use("store.api")?.getBot({ botId })
  if (!bot) return "unavailable"
  if (bot.machine === "local" || (source === "computer" && bot.hostComputerUse))
    return JSON.stringify(["host", hostname(), bot.machine])
  const connection = kernel.services
    .use("vm.runtime")
    ?.states()
    .find((state) => state.botId === botId)?.connection

  return JSON.stringify(["guest", bot.machine, connection?.machineId ?? storedMachineId(kernel, botId) ?? botId])
}

export const bindApprovalScope = (kernel: Kernel, botId: string, scope: ApprovalScope): BoundScope => ({
  ...scope,
  destination: approvalDestination(kernel, botId, scope.source),
})

export const sameScope = (a: BoundScope, b: BoundScope): boolean =>
  a.source === b.source && a.tool === b.tool && a.server === b.server && a.destination === b.destination

/**
 * Grants saved before destinations existed carry none. The user granted them where the
 * bot ran at the time, so they adopt the bot's current destination once and persist it;
 * host computer input is the exception because a guest-era grant never covered the host.
 */
const adoptLegacyGrant = (kernel: Kernel, botId: string, grant: StandingGrant): StandingGrant | null => {
  if (!grant?.scope) return null
  if ((grant.scope as BoundScope).destination !== undefined) return grant
  const bot = kernel.services.use("store.api")?.getBot({ botId })
  if (!bot || (grant.scope.source === "computer" && bot.hostComputerUse)) return null

  return { ...grant, scope: bindApprovalScope(kernel, botId, grant.scope) }
}

export const createStandingGrantStore = (kernel: Kernel) => {
  const database = kernel.db as Database
  const key = (botId: string) => `approval-grants:${botId}`
  const list = (botId: string): StandingGrant[] => {
    if (typeof database.query !== "function") return []
    const row = database.query("SELECT value_json FROM settings WHERE key = ?").get(key(botId)) as {
      value_json: string
    } | null
    if (!row) return []
    let saved: StandingGrant[]
    try {
      saved = JSON.parse(row.value_json) as StandingGrant[]
    } catch {
      return []
    }
    if (!Array.isArray(saved) || !kernel.services.use("store.api")?.getBot({ botId })) return []
    const current = saved
      .map((grant) => adoptLegacyGrant(kernel, botId, grant))
      .filter(
        (grant): grant is StandingGrant =>
          grant !== null &&
          grant.botId === botId &&
          (grant.scope as BoundScope).destination === approvalDestination(kernel, botId, grant.scope.source),
      )
    if (current.length !== saved.length || current.some((grant, index) => grant !== saved[index])) save(botId, current)
    return current
  }
  const save = (botId: string, grants: StandingGrant[]) => {
    database
      .query(
        "INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      )
      .run(key(botId), JSON.stringify(grants), Date.now())
  }
  const has = (botId: string, scope: ApprovalScope) =>
    list(botId).some((grant) => sameScope(grant.scope, bindApprovalScope(kernel, botId, scope)))
  const add = (botId: string, scope: ApprovalScope) => {
    const grants = list(botId)
    const bound = bindApprovalScope(kernel, botId, scope)
    if (!grants.some((grant) => sameScope(grant.scope, bound)))
      save(botId, [...grants, { id: kernel.newId(), botId, scope: bound, grantedAt: Date.now() }])
  }
  const revoke = (botId: string, grantId: string) =>
    save(
      botId,
      list(botId).filter((grant) => grant.id !== grantId),
    )
  const revokeServer = (botId: string, server: string) =>
    save(
      botId,
      list(botId).filter((grant) => grant.scope.source !== "mcp" || grant.scope.server !== server),
    )
  const revokeSecret = (secretId: string) => {
    const rows = database
      .query("SELECT key, value_json FROM settings WHERE key LIKE 'approval-grants:%'")
      .all() as Array<{ key: string; value_json: string }>
    for (const row of rows) {
      const botId = row.key.slice("approval-grants:".length)
      save(
        botId,
        list(botId).filter((grant) => {
          try {
            const ref = JSON.parse(grant.scope.server ?? "null") as unknown
            return !Array.isArray(ref) || ref[0] !== "saved-secret" || ref[1] !== secretId
          } catch {
            return true
          }
        }),
      )
    }
  }
  return { list, has, add, revoke, revokeServer, revokeSecret }
}

export const registerStandingGrantRoutes = (kernel: Kernel): void => {
  const grants = createStandingGrantStore(kernel)
  kernel.registerRoutes({
    name: "approval-grants",
    routes: [
      {
        method: "GET",
        path: "/bots/:id/grants",
        handler: async ({ params }) => {
          if (!kernel.services.use("store.api")?.getBot({ botId: params.id ?? "" }))
            return { status: 404, json: { error: "Bot não encontrado." } }
          return { status: 200, json: { grants: grants.list(params.id ?? "") } }
        },
      },
      {
        method: "DELETE",
        path: "/bots/:id/grants/:grant",
        handler: async ({ params }) => {
          if (
            !kernel.services.use("store.api")?.getBot({ botId: params.id ?? "" }) ||
            !grants.list(params.id ?? "").some((grant) => grant.id === params.grant)
          )
            return { status: 404, json: { error: "Permissão não encontrada." } }
          grants.revoke(params.id ?? "", params.grant ?? "")
          return { status: 200, json: {} }
        },
      },
    ],
  })
}
