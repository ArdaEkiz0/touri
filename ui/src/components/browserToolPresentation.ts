import type { ToolCallPart } from "@touri/contracts"
import { redactToolText } from "@touri/contracts/redaction"
import { asToolRecord, parseToolValue, prettyToolValue, toolIdentity, toolLeaf } from "./toolPresentation"

const names: Record<string, string> = {
  open: "Abrir página",
  navigate: "Abrir página",
  click: "Clicar",
  type: "Digitar",
  fill_form: "Preencher formulário",
  snapshot: "Ler página",
  screenshot: "Captura",
  take_screenshot: "Captura",
  list_tabs: "Listar abas",
  tabs: "Listar abas",
  close_tab: "Fechar aba",
  close: "Fechar aba",
  press: "Pressionar tecla",
  press_key: "Pressionar tecla",
  scroll: "Rolar página",
  hover: "Passar o mouse",
  wait_for: "Aguardar página",
  evaluate: "Executar na página",
  select_option: "Selecionar opção",
  set_checked: "Marcar opção",
  fill_secret: "Preencher credencial",
  submit_secret: "Preencher credencial",
  request_takeover: "Pedir controle ao usuário",
  upload_files: "Enviar arquivos",
}

const clip = (value: string, limit = 120): string => (value.length > limit ? `${value.slice(0, limit)}…` : value)

const describeTarget = (value: unknown): string | null => {
  if (typeof value === "string") return `elemento ${value}`
  const target = asToolRecord(value)
  if (!target) return null
  if (target.kind === "role" || typeof target.role === "string")
    return `${String(target.role ?? "elemento")}${typeof target.name === "string" ? ` "${clip(target.name, 60)}"` : ""}`
  if (typeof target.text === "string") return `texto "${clip(target.text, 60)}"`
  if (typeof target.selector === "string") return `seletor ${clip(target.selector, 60)}`
  if (target.kind === "point") return `ponto (${String(target.x)}, ${String(target.y)})`
  if (typeof target.ref === "string") return `elemento ${target.ref}`
  return null
}

const describeCondition = (value: unknown): string | null => {
  const condition = asToolRecord(value)
  if (!condition) return null
  if (typeof condition.text === "string") return `texto "${clip(condition.text, 60)}"`
  if (typeof condition.url === "string") return `endereço com ${clip(condition.url, 60)}`
  if (typeof condition.state === "string") return `estado ${condition.state}`
  return describeTarget(condition.target)
}

const NAVIGATE_ACTIONS: Record<string, string> = { back: "Voltar", forward: "Avançar", reload: "Recarregar" }

/** One pt-BR clause saying what the browser tool is doing, without echoing secrets. */
export const browserActionDetail = ({
  action,
  args,
}: {
  action: string
  args: Record<string, unknown> | null
}): string | null => {
  if (!args) return null
  if (action === "navigate" && typeof args.action === "string" && NAVIGATE_ACTIONS[args.action])
    return NAVIGATE_ACTIONS[args.action] ?? null
  if (typeof args.url === "string") return clip(args.url, 180)
  if (action === "type") {
    const where = describeTarget(args.target)
    return typeof args.text === "string"
      ? `${clip(args.text, 60)}${where ? ` em ${where}` : ""}${args.submit === true ? " e Enter" : ""}`
      : where
  }
  if (action === "scroll")
    return args.target ? describeTarget(args.target) : args.direction === "up" ? "para cima" : "para baixo"
  if (action === "wait_for") return describeCondition(args.condition)
  if (action === "request_takeover") return typeof args.reason === "string" ? clip(args.reason, 140) : null
  if (action === "evaluate") return typeof args.expression === "string" ? clip(args.expression, 80) : null
  if (action === "select_option")
    return Array.isArray(args.values) ? `${args.values.join(", ")} em ${describeTarget(args.target) ?? "lista"}` : null
  if (action === "set_checked")
    return `${args.checked === true ? "marcar" : "desmarcar"} ${describeTarget(args.target) ?? ""}`.trim()
  if (action === "submit_secret") return "usuário e senha pelo cofre (valores não exibidos)"
  if (typeof args.selector === "string") return clip(args.selector, 180)
  if (typeof args.text === "string") return clip(args.text, 180)
  if (typeof args.key === "string") return args.key
  return describeTarget(args.target)
}

const ERROR_LINE = /ERROR\s+([A-Z_]+):\s*([^\n]+)/

/** Failure cause from an MCP browser result, in the words the engine used. */
export const browserFailureCause = (raw: string | null): string | null => {
  if (!raw) return null
  const text = redactToolText(raw)
  const direct = ERROR_LINE.exec(text.replace(/\\n/g, "\n"))
  if (direct?.[2]) return clip(direct[2].replace(/\\"|"\}.*$/g, "").trim(), 160)
  const parsed = asToolRecord(parseToolValue(text))
  return typeof parsed?.error === "string" ? clip(parsed.error, 160) : null
}
export const browserToolPresentation = (part?: ToolCallPart) => {
  if (!part || toolIdentity(part.tool).kind !== "browser") return null
  const value = parseToolValue(redactToolText(part.inputJson))
  const args = asToolRecord(value)
  const action = toolLeaf(part.tool).replace(/^(browser|computer)_/, "")
  const name = names[action] ?? (toolIdentity(part.tool).kind === "browser" ? "Usar navegador" : "Usar computador")
  const safeArgs = args
    ? Object.fromEntries(Object.entries(args).filter(([, value]) => value != null && value !== ""))
    : null
  const labels: Record<string, string> = {
    url: "URL",
    selector: "Seletor",
    text: "Texto",
    target: "Alvo",
    tabId: "Aba",
    key: "Tecla",
    ref: "Referência",
    element: "Elemento",
  }
  const detail = browserActionDetail({ action, args: safeArgs })
  const cause = part.ok === false ? browserFailureCause(part.outputJson) : null
  const headline = detail ? `${name} · ${detail}` : name
  return {
    name,
    summary: cause ? `${headline} — falhou: ${cause}` : headline,
    code:
      safeArgs && Object.keys(safeArgs).length
        ? prettyToolValue(
            Object.fromEntries(Object.entries(safeArgs).map(([key, value]) => [labels[key] ?? key, value])),
          )
        : typeof value === "string" && /^[{[]/.test(value)
          ? "Parâmetros incompletos. Abra os detalhes técnicos."
          : "",
    technical:
      safeArgs && Object.keys(safeArgs).length
        ? JSON.stringify(safeArgs, null, 2)
        : typeof value === "string" && value.trim()
          ? redactToolText(part.inputJson)
          : "",
  }
}

/** Keep page context and screenshots without exposing base64 or empty MCP envelopes. */
export const browserToolResult = (raw: string | null): { title: string; url: string; output: string | null } => {
  const texts: unknown[] = []
  const images: unknown[] = []
  let title = ""
  let url = ""
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 6 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    const record = asToolRecord(value)
    if (!record) {
      if (typeof value === "string" && value.trim()) texts.push({ type: "text", text: redactToolText(value) })
      return
    }
    if (record.type === "image") {
      images.push(record)
      return
    }
    if (record.type === "text" && typeof record.text === "string") {
      visit(parseToolValue(record.text), depth + 1)
      return
    }
    if (typeof record.title === "string") title = redactToolText(record.title)
    if (typeof record.url === "string") url = redactToolText(record.url)
    if (record.content || record.structured || record.structuredContent) {
      visit(record.structured ?? record.structuredContent, depth + 1)
      visit(record.content, depth + 1)
      return
    }
    if (record.image) visit(record.image, depth + 1)
    if (typeof record.dataUrl === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(record.dataUrl)) {
      const mimeType = record.dataUrl.slice(5, record.dataUrl.indexOf(";"))
      images.push({ type: "image", mimeType, data: record.dataUrl })
    }
    const useful = Object.fromEntries(
      Object.entries(record).filter(
        ([key, value]) =>
          !["image", "dataUrl", "title", "url"].includes(key) &&
          value != null &&
          value !== "" &&
          !(Array.isArray(value) && !value.length),
      ),
    )
    if (Object.keys(useful).length) texts.push({ type: "text", text: redactToolText(JSON.stringify(useful)) })
  }
  if (raw) visit(parseToolValue(raw))
  return {
    title,
    url,
    output: images.length || texts.length ? JSON.stringify({ content: [...images, ...texts] }) : null,
  }
}
