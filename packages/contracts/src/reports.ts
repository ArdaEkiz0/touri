/** Reports are frozen, redacted snapshots. Delivery accepts only a prepared id. */
export const reportParts = [
  "versions",
  "doctor",
  "logs",
  "errors",
  "states",
  "database",
  "memory",
  "runs",
  "transcript",
] as const
export type ReportPart = (typeof reportParts)[number]
export type ReportInput = {
  repository?: string
  title: string
  happened: string
  expected: string
  steps: string
  severity: "crash" | "bug" | "suggestion"
  botId: string | null
  threadId: string | null
  errorCode: string | null
  parts: ReportPart[]
  transcriptBranch?: "active" | "all"
  transcriptMessageIds?: string[] | undefined
  previewEdits?: { id: string; reportJson: string; logs: Record<string, string> }
  images: Array<{ id?: string; mime: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string }>
}
export type ReportSnapshot = {
  id: string
  createdAt: number
  report: Record<string, unknown>
  logs: Record<string, string>
  images: Array<{ name: string; mime: string; dataBase64: string }>
  summary: string
  githubUrl: string | null
}
export type ReportHistory = { id: string; date: number; title: string; destination: "zip" | "github" | "cloud" }
export const reportSizeLimit = 10 * 1024 * 1024

/** Apply registered kernel secrets first, then conservative report-only privacy rules. Private IPs are allowed. */
export const redactReportText = (text: string, registered: (text: string) => string = (value) => value): string => {
  let value = registered(text)
  // Decode JSON before masking so escaped secrets in structured/JSONL logs cannot bypass registration.
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === "object")
      return JSON.stringify(redactReportValue(parsed, (value) => redactReportText(value, registered)))
    if (typeof parsed === "string" && parsed !== value) return JSON.stringify(redactReportText(parsed, registered))
  } catch {
    /* ordinary text */
  }
  value = value.replace(
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    "[REDACTED]",
  )
  value = value.replace(
    /(?:^|\n)(?:[A-Za-z0-9+/=]+\r?\n)+-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g,
    "[REDACTED]",
  )
  // Preserve whole-block PEM masking first, then decode each structured log
  // record. Multiple JSONL records are not themselves valid JSON.
  if (value.includes("\n"))
    value = value
      .split("\n")
      .map((line) => {
        try {
          const parsed: unknown = JSON.parse(line)
          if ((parsed && typeof parsed === "object") || typeof parsed === "string")
            return redactReportText(line, registered)
        } catch {
          /* ordinary log/prose line */
        }
        return line
      })
      .join("\n")
  const rules = [
    /\bsk-[\w-]+/g,
    /\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[0-9A-Z]{16})\b/g,
    /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,
    /\bBearer\s+[^\s"'\\,;]+/gi,
    /((?:authorization|proxy-authorization|set-cookie|cookie)["']?\s*[:=]\s*)[^\r\n]+/gi,
    /((?:[\w.-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|credential|authentication|auth[_-]?(?:key|token)|session[_-]?(?:key|id)|token|password|passwd|secret|cpf|phone|telefone|celular|e-?mail)[\w.-]*)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi,
    /\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s"']*/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
    /\+\d(?:[ ().-]*\d){7,14}(?!\d)/g,
    /(?<!\d)\d{11}(?!\d)/g,
    /(?<!\d)[1-9]\d{9}(?!\d)/g,
    /(?<!\d)(?:\+?55[ .-]?)?\(?[1-9]\d\)?[ .-]?(?:9[ .-]?)?\d{4}[ .-]\d{4}(?!\d)/g,
    /(?<!\d)(?:\+55\s*)?\(?[1-9]\d\)?\s+9?\d{4}\s*[-.]?\s*\d{4}(?!\d)/g,
  ]
  for (const rule of rules) value = value.replace(rule, "[REDACTED]")
  value = value.replace(/(?:\/Users\/|\/home\/)[^/\s"'\\]+(?=\/|\b)/g, "~")
  value = value.replace(/[A-Z]:\\Users\\[^\\\s"']+/gi, "~")
  value = value.replace(/\bfile:\/\/[^\s"'<>]+/gi, "[REDACTED]")
  value = value.replace(/(?<![\w:/~])\/(?!\/)[^\s"'<>[\]{},;]+/g, "[REDACTED]")
  value = value.replace(/\b[A-Z]:[\\/][^\s"'<>]+|\\\\[^\s"'<>]+/gi, "[REDACTED]")
  value = value.replace(/(?<![\w:])(?:[a-f\d]{0,4}:){2,7}[a-f\d]{0,4}(?![\w:])/gi, (ip) =>
    ip === "::1" || /^(?:fc|fd|fe80:)/i.test(ip) ? ip : "[REDACTED]",
  )
  return value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) => {
    const [a = 0, b = 0] = ip.split(".").map(Number)
    return a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
      ? ip
      : "[REDACTED]"
  })
}

export const redactReportValue = (input: unknown, redact: (value: string) => string): unknown => {
  if (typeof input === "string") return redact(input)
  if (Array.isArray(input)) return input.map((value) => redactReportValue(value, redact))
  if (input && typeof input === "object")
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        redact(key),
        /api[_-]?key|access[_-]?key|private[_-]?key|credential|authentication|auth[_-]?(?:key|token)|session[_-]?(?:key|id)|token|password|passwd|secret|cookie|authorization|cpf|phone|telefone|celular|e-?mail/i.test(
          key,
        )
          ? "[REDACTED]"
          : redactReportValue(value, redact),
      ]),
    )
  return input
}

/** Text-only edits create another frozen snapshot. Images and log filenames
 * remain those the user already reviewed; user edits undergo redaction again. */
export const editReportSnapshot = (
  snapshot: ReportSnapshot,
  edits: NonNullable<ReportInput["previewEdits"]>,
  id: string,
  repository: string,
  registered?: (text: string) => string,
): ReportSnapshot => {
  const value: unknown = JSON.parse(edits.reportJson)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Prévia JSON inválida.")
  const fields = value as Record<string, unknown>
  if (
    ["title", "happened", "expected", "steps"].some(
      (key) => typeof fields[key] !== "string" || String(fields[key]).length > 16000,
    )
  )
    throw new Error("Preserve os campos de texto do relatório.")
  if (Object.keys(edits.logs).some((name) => !(name in snapshot.logs))) throw new Error("Log desconhecido na prévia.")
  const redact = (text: string) => redactReportText(text, registered)
  const createdAt = Date.now()
  const report = redactReportValue({ ...fields, id, createdAt }, redact) as Record<string, unknown>
  return {
    ...snapshot,
    id,
    createdAt,
    report,
    logs: Object.fromEntries(Object.entries(edits.logs).map(([name, text]) => [name, redact(text)])),
    summary: reportSummary(report),
    githubUrl: githubReportUrl(repository, report),
  }
}

/** Minimal ZIP (stored entries, UTF-8 names), shared with the offline desktop fallback. */
export const reportZip = (snapshot: ReportSnapshot): Uint8Array<ArrayBuffer> => {
  const encoder = new TextEncoder()
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "report.json", data: encoder.encode(JSON.stringify(snapshot.report, null, 2)) },
    ...Object.entries(snapshot.logs).map(([name, text]) => ({ name: `logs/${name}`, data: encoder.encode(text) })),
    ...snapshot.images.map((image) => ({
      name: `images/${image.name}`,
      data: Uint8Array.from(atob(image.dataBase64), (c) => c.charCodeAt(0)),
    })),
  ]
  const crc = (bytes: Uint8Array) => {
    let value = 0xffffffff
    for (const byte of bytes) {
      value ^= byte
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunks: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const header = new Uint8Array(30 + name.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x800, true)
    view.setUint32(14, crc(file.data), true)
    view.setUint32(18, file.data.length, true)
    view.setUint32(22, file.data.length, true)
    view.setUint16(26, name.length, true)
    header.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    central.set(header.subarray(4, 28), 6)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    chunks.push(header, file.data)
    directory.push(central)
    offset += header.length + file.data.length
  }
  const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0)
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(8, files.length, true)
  view.setUint16(10, files.length, true)
  view.setUint32(12, directorySize, true)
  view.setUint32(16, offset, true)
  const result = new Uint8Array(offset + directorySize + end.length)
  let cursor = 0
  for (const bytes of [...chunks, ...directory, end]) {
    result.set(bytes, cursor)
    cursor += bytes.length
  }
  return result
}
export const reportSummary = (report: Record<string, unknown>) =>
  `${String(report.title).slice(0, 180)}\n\nO que aconteceu?\n${String(report.happened).slice(0, 1200)}\n\nO que você esperava?\n${String(report.expected).slice(0, 1200)}\n\nPassos\n${String(report.steps || "Não informados").slice(0, 1200)}\n\nSeveridade: ${report.severity === "crash" ? "Travou" : report.severity === "suggestion" ? "Sugestão" : "Algo errado"}\nCódigo: ${report.errorCode || "Não informado"}\n\nAnexe o .zip manualmente após revisar seu conteúdo.`

export const githubReportUrl = (repository: string, report: Record<string, unknown>): string | null => {
  const match = repository
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?$/)
  if (!match) return null
  return `https://github.com/${match[1]}/issues/new?${new URLSearchParams({ title: String(report.title).slice(0, 180), body: reportSummary(report).slice(0, 5000) })}`
}
