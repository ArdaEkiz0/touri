import { createHash } from "node:crypto"
import type { Kernel, ToolContext } from "@touri/contracts"
import { approvalDestination, createStandingGrantStore } from "./grants"
import { approvalOutcome } from "./outcome"

export type SavedSecret = { id: string; name: string; account: string; revision: number }

const mutations = new WeakMap<object, Map<string, Promise<void>>>()
export const withSecretMutation = async <T>(kernel: Kernel, account: string, action: () => Promise<T>): Promise<T> => {
  const key = kernel.db as object
  const accounts = mutations.get(key) ?? new Map<string, Promise<void>>()
  mutations.set(key, accounts)
  const previous = accounts.get(account) ?? Promise.resolve()
  let release: () => void = () => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  accounts.set(account, current)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (accounts.get(account) === current) accounts.delete(account)
  }
}

export const approveSecretRelease = async ({
  kernel,
  ctx,
  secret,
  destination,
  destinationLabel,
  toolName,
  isCurrent,
}: {
  kernel: Kernel
  ctx: Pick<ToolContext, "botId" | "threadId" | "runId" | "signal">
  secret: SavedSecret
  destination: string
  destinationLabel?: string
  toolName: string
  isCurrent: () => boolean
}): Promise<(() => boolean) | null> => {
  const present = kernel.services.use("approvals.present")
  if (!present || ctx.signal.aborted || !isCurrent()) return null
  const machine = approvalDestination(kernel, ctx.botId)
  const current = () => !ctx.signal.aborted && approvalDestination(kernel, ctx.botId) === machine && isCurrent()
  const scope = {
    source: "mcp" as const,
    tool: toolName,
    server: JSON.stringify([
      "saved-secret",
      secret.id,
      secret.account,
      secret.revision,
      createHash("sha256").update(destination).digest("hex"),
    ]),
  }
  const approved = await present({
    ctx,
    scope,
    toolName: toolName === "env_export" ? "Exportar credencial para o ambiente" : "Preencher credencial no navegador",
    input: { credencial: secret.name, destino: destinationLabel ?? destination },
    isCurrent: current,
  })
  if (!approved.success || approved.behavior !== "allow" || !current()) return null
  const standing = approved.message === approvalOutcome.automatic || approved.message === approvalOutcome.standing
  return () => current() && (!standing || createStandingGrantStore(kernel).has(ctx.botId, scope))
}
