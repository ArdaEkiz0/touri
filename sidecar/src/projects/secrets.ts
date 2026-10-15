import type { Kernel, ToolContext } from "@touri/contracts"
import { approveSecretRelease } from "../approvals/secrets"
import type { ProjectResult, ProjectStore } from "./types"

export const resolveEnvSecret = async ({
  kernel,
  store,
  ctx,
  projectId,
  name,
  destination,
  destinationLabel,
  isCurrent = () => true,
}: {
  kernel: Kernel
  store: ProjectStore
  ctx: ToolContext
  projectId: string
  name: string
  destination: string
  destinationLabel?: string
  isCurrent?: () => boolean
}): Promise<ProjectResult<{ value: string; isCurrent: () => boolean }>> => {
  const secret = store.getSecret({ projectId, name })
  if (!secret) return { success: false, errorCode: "SECRET_NOT_FOUND", error: "Credencial não encontrada." }
  if (secret.usage.env !== true)
    return { success: false, errorCode: "DENIED", error: "Esta credencial não permite exportação para o ambiente." }
  const bot = kernel.services.use("store.api")?.getBot({ botId: ctx.botId })
  const policy = JSON.stringify([bot?.machine, bot?.projectId, bot?.access, bot?.approvals])
  const current = () => {
    const latest = store.getSecret({ projectId, name })
    const latestBot = kernel.services.use("store.api")?.getBot({ botId: ctx.botId })
    return (
      !!latest &&
      latest.id === secret.id &&
      latest.updatedAt === secret.updatedAt &&
      latest.usage.env === true &&
      !!latestBot &&
      latestBot.projectId === projectId &&
      latestBot.access !== "read-only" &&
      JSON.stringify([latestBot.machine, latestBot.projectId, latestBot.access, latestBot.approvals]) === policy &&
      isCurrent()
    )
  }
  const account = `${projectId}/${name}`
  const allowed = await approveSecretRelease({
    kernel,
    ctx,
    secret: { id: secret.id, name, account, revision: secret.updatedAt },
    destination,
    ...(destinationLabel ? { destinationLabel } : {}),
    toolName: "env_export",
    isCurrent: current,
  })
  if (!allowed?.())
    return { success: false, errorCode: "DENIED", error: "A exportação da credencial não foi aprovada." }
  const fetched = await kernel.callHost("keychain.get", { account })
  if (!allowed()) return { success: false, errorCode: "DENIED", error: "A autorização da credencial mudou." }
  if (!fetched.success)
    return { success: false, errorCode: fetched.errorCode, error: "Não foi possível acessar o cofre." }
  if (fetched.value.value === null)
    return { success: false, errorCode: "SECRET_NOT_PROVIDED", error: "A credencial não possui um valor salvo." }
  kernel.addRedactionValue(fetched.value.value)
  return { success: true, value: fetched.value.value, isCurrent: allowed }
}
