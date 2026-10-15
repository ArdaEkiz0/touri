import type { Id, Message } from "@touri/contracts"
import { resolvedApprovalLabel } from "./approvalState"
import { localizeNotice, t } from "./i18n"
import { markdownSummary } from "./markdownSummary"
import { runErrorFor } from "./runError"

const PREVIEW_LIMIT = 90

const textOf = (message: Message): string => {
  if (message.status === "canceled") return t("Cancelado por você")
  const error = runErrorFor(message)
  if (error) return error.title
  if (message.role === "system") return localizeNotice(message.text)
  if (message.text.trim()) return message.text
  const text = message.parts.find((part) => part.type === "text" && part.text.trim())
  if (text?.type === "text") return text.text
  const approval = [...message.parts].reverse().find((part) => part.type === "approval")
  if (approval?.type === "approval") {
    if (approval.decision === "pending") return "Aguardando sua aprovação"
    const label = resolvedApprovalLabel(approval.decision)
    return approval.resolvedAt === undefined
      ? label
      : `${label} · ${new Date(approval.resolvedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
  }
  const notice = message.parts.find((part) => part.type === "notice" && part.text.trim())
  return notice?.type === "notice" ? localizeNotice(notice.text) : ""
}

const compact = (value: string): string => {
  const flat = markdownSummary(value)
  return flat.length > PREVIEW_LIMIT ? `${flat.slice(0, PREVIEW_LIMIT - 1)}…` : flat
}

/** Latest readable message across the given threads, newest first; empty string when none has any text. */
export const latestPreview = ({
  threadIds,
  messages,
}: {
  threadIds: ReadonlyArray<Id>
  messages: ReadonlyArray<Message>
}): string => {
  const candidates = [...messages]
    .filter((message) => threadIds.includes(message.threadId))
    .sort((left, right) => right.createdAt - left.createdAt)
  const latest = candidates.find((message) => textOf(message).length > 0)
  return latest ? compact(textOf(latest)) : ""
}
