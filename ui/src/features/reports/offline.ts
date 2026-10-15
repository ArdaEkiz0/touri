import {
  githubReportUrl,
  type ReportHistory,
  type ReportInput,
  type ReportSnapshot,
  redactReportText,
  redactReportValue,
  reportSummary,
} from "@touri/contracts"
import packageInfo from "../../../../package.json"
import type { TauriInvoke } from "../../api/client"

const historyKey = "touri-report-history"
export const offlineHistory = (): ReportHistory[] => {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(historyKey) ?? "[]")
    return Array.isArray(items)
      ? items
          .filter(
            (item): item is ReportHistory =>
              item &&
              typeof item.id === "string" &&
              typeof item.title === "string" &&
              typeof item.date === "number" &&
              ["zip", "github"].includes(item.destination),
          )
          .slice(0, 100)
      : []
  } catch {
    return []
  }
}
export const rememberOfflineReport = (item: ReportHistory) => {
  localStorage.setItem(
    historyKey,
    JSON.stringify(
      [
        item,
        ...offlineHistory().filter((previous) => previous.id !== item.id || previous.destination !== item.destination),
      ].slice(0, 100),
    ),
  )
}
export const buildOfflineReport = async (input: ReportInput, invoke: TauriInvoke): Promise<ReportSnapshot> => {
  const shell = await invoke("report_shell_diagnostics", {}).catch(() => null)
  const redact = (text: string) => redactReportText(shell?.home ? text.replaceAll(shell.home, "~") : text)
  const diagnostics: Record<string, unknown> = {}
  const unavailable: Record<string, string> = {}
  for (const part of input.parts) {
    if (part === "versions")
      diagnostics.versions = shell?.versions ?? { app: packageInfo.version, os: navigator.platform }
    else if (part === "errors") {
      const counts: Record<string, number> = {}
      for (const code of Object.values(shell?.logs ?? {})
        .join("\n")
        .match(/TOURI-E\d{4}/g) ?? [])
        counts[code] = (counts[code] ?? 0) + 1
      diagnostics.errors = { counts, window: "Últimas 500 linhas de cada log" }
    } else if (part !== "logs") unavailable[part] = "Sidecar indisponível; esta parte não pôde ser coletada."
  }
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const { images, ...fields } = input
  const report = redactReportValue(
    { formatVersion: 1, id, createdAt, ...fields, offline: true, diagnostics, unavailable },
    redact,
  ) as Record<string, unknown>
  return {
    id,
    createdAt,
    report,
    summary: reportSummary(report),
    githubUrl: githubReportUrl(input.repository ?? "", report),
    logs: input.parts.includes("logs")
      ? Object.fromEntries(Object.entries(shell?.logs ?? {}).map(([name, text]) => [name, redact(text)]))
      : {},
    images: images.map((image, index) => ({
      mime: image.mime,
      dataBase64: image.dataBase64,
      name: `captura-${index + 1}.${image.mime === "image/jpeg" ? "jpg" : image.mime === "image/webp" ? "webp" : "png"}`,
    })),
  }
}
