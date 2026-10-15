import type { ToolResult } from "@touri/contracts"

export const approvalOutcome = {
  once: "Aprovado pelo usuário (uma vez).",
  standing: "Aprovado: sempre para esta ferramenta neste bot.",
  automatic: "Aprovado automaticamente pela permissão permanente desta ferramenta neste bot.",
  denied: "Negado pelo usuário.",
} as const

// Preserve the tool's payload, including images and structured output. Consent is
// separate from execution success: an approved tool can still fail.
export const withApprovalOutcome = (result: ToolResult, message?: string): ToolResult =>
  message ? { ...result, content: [{ type: "text", text: message }, ...(result.content ?? [])] } : result
