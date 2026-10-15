import type { McpServer, McpTool, McpToolPolicy } from "@touri/contracts"
import { useEffect, useRef, useState } from "react"
import type { UiApi } from "../api/client"
import { t } from "../i18n"
import { McpCatalog } from "./McpCatalog"

export const BotMcpSettings = ({
  api,
  botId,
  onOpenIntegrations,
  onPermissionsChange,
  focusOnOpen = false,
}: {
  api: UiApi
  botId: string
  onOpenIntegrations?: () => void
  onPermissionsChange?: () => void
  focusOnOpen?: boolean
}) => {
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focusOnOpen) return
    sectionRef.current?.scrollIntoView?.({ block: "start" })
    sectionRef.current?.focus({ preventScroll: true })
  }, [focusOnOpen])
  const [servers, setServers] = useState<McpServer[]>([])
  const [name, setName] = useState("")
  const [transport, setTransport] = useState<"stdio" | "http">("stdio")
  const [endpoint, setEndpoint] = useState("")
  const [args, setArgs] = useState("[]")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api
      .request("GET /bots/:id/mcp", {}, { id: botId })
      .then((result) => {
        if (active) setServers(result.servers)
      })
      .catch(() => {
        if (active) setError(t("Não foi possível carregar os servidores MCP."))
      })
    return () => {
      active = false
    }
  }, [api, botId])
  const attach = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const server: McpServer =
        transport === "http"
          ? { name: name.trim(), transport, url: endpoint.trim(), tools: [] }
          : { name: name.trim(), transport, command: endpoint.trim(), args: JSON.parse(args), tools: [] }
      const result = await api.request("PUT /bots/:id/mcp/:name", server, { id: botId, name: server.name })
      setServers((current) => [...current.filter((item) => item.name !== result.server.name), result.server])
      onPermissionsChange?.()
      setName("")
      setEndpoint("")
      setArgs("[]")
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Servidor MCP indisponível."))
    } finally {
      setBusy(false)
    }
  }
  const updateTool = async (
    server: McpServer,
    tool: McpTool,
    patch: { classification?: "reads" | "writes"; policy?: McpToolPolicy },
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.request(
        "PATCH /bots/:id/mcp/:name/tools/:tool",
        {
          classification: patch.classification ?? tool.classification ?? "writes",
          policy: patch.policy ?? tool.policy ?? "needs_approval",
        },
        { id: botId, name: server.name, tool: tool.name },
      )
      setServers((current) => current.map((value) => (value.name === server.name ? result.server : value)))
      onPermissionsChange?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível atualizar a política.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section ref={sectionRef} tabIndex={-1} className="bot-mcp-settings" aria-label={t("Servidores MCP deste bot")}>
      <h3>{t("Servidores MCP deste bot")}</h3>
      <p>{t("Conecte um servidor para disponibilizar suas ferramentas somente a este bot.")}</p>
      {onOpenIntegrations && (
        <button type="button" className="text-button" onClick={onOpenIntegrations}>
          Abrir Integrações
        </button>
      )}
      <McpCatalog
        onSelect={(server) => {
          setName(server.name)
          setTransport(server.transport)
          setEndpoint(server.transport === "stdio" ? server.command : server.url)
          setArgs(server.transport === "stdio" ? JSON.stringify(server.args) : "[]")
        }}
      />
      {servers.length === 0 && (
        <p>{t("Nenhum servidor externo conectado. Gmail e outras integrações precisam de uma conexão MCP.")}</p>
      )}
      {servers.map((server) => (
        <article key={server.name}>
          <strong>
            {server.name} · {server.transport}
          </strong>
          {server.tools.length === 0 && <p>{t("Nenhuma ferramenta anunciada.")}</p>}
          {server.tools.map((tool) => (
            <fieldset key={tool.name} disabled={busy}>
              <legend>{tool.name}</legend>
              {tool.description && <p>{tool.description}</p>}
              <label>
                Classificação · {tool.name}
                <select
                  value={tool.classification ?? "writes"}
                  onChange={(event) =>
                    void updateTool(server, tool, { classification: event.target.value as "reads" | "writes" })
                  }
                >
                  <option value="reads">Leitura</option>
                  <option value="writes">Escrita</option>
                </select>
              </label>
              <label>
                Política · {tool.name}
                <select
                  value={tool.policy ?? "needs_approval"}
                  onChange={(event) => void updateTool(server, tool, { policy: event.target.value as McpToolPolicy })}
                >
                  <option value="always_allow">Sempre permitir</option>
                  <option value="needs_approval">Pedir aprovação</option>
                  <option value="blocked">Bloquear</option>
                </select>
              </label>
            </fieldset>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void api
                .request("DELETE /bots/:id/mcp/:name", {}, { id: botId, name: server.name })
                .then(() => {
                  setServers((current) => current.filter((item) => item.name !== server.name))
                  onPermissionsChange?.()
                })
                .catch(() => setError(t("Não foi possível desconectar o servidor MCP.")))
            }
          >
            {t("Desconectar")}
          </button>
        </article>
      ))}
      <label>
        {t("Nome do servidor MCP")}
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        {t("Transporte MCP")}
        <select value={transport} onChange={(event) => setTransport(event.target.value as "stdio" | "http")}>
          <option value="stdio">stdio</option>
          <option value="http">HTTP</option>
        </select>
      </label>
      <label>
        {transport === "stdio" ? t("Comando MCP") : t("URL MCP")}
        <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
      </label>
      {transport === "stdio" && (
        <label>
          {t("Argumentos MCP (lista JSON)")}
          <input value={args} onChange={(event) => setArgs(event.target.value)} />
        </label>
      )}
      <button
        type="button"
        className="button button-quiet"
        disabled={busy || !name.trim() || !endpoint.trim()}
        onClick={() => void attach()}
      >
        {busy ? t("Verificando ferramentas…") : t("Conectar servidor MCP")}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
