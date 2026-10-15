import type { McpServer, McpTool, McpToolPolicy } from "@touri/contracts"
import { useEffect, useRef, useState } from "react"
import type { UiApi } from "../api/client"
import { localizeNotice } from "../i18n"
import { ScreenState } from "./ScreenPrimitives"

export const useScreenConnections = (api: UiApi, botId: string | null, refreshKey?: boolean) => {
  const [servers, setServers] = useState<McpServer[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [revision, setRevision] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh when the configuration dialog closes
  useEffect(() => {
    let active = true
    setServers([])
    if (!botId) {
      setStatus("ready")
      return
    }
    setStatus("loading")
    void api
      .request("GET /bots/:id/mcp", {}, { id: botId })
      .then((response) => {
        if (active) {
          setServers(response.servers)
          setStatus("ready")
        }
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [api, botId, revision, refreshKey])
  return { servers, setServers, status, retry: () => setRevision((value) => value + 1) }
}

export const ScreenServerPolicies = ({
  api,
  botId,
  server,
  onUpdate,
}: {
  api: UiApi
  botId: string
  server: McpServer
  onUpdate: (server: McpServer) => void
}) => {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const update = async (tool: McpTool, patch: { classification?: "reads" | "writes"; policy?: McpToolPolicy }) => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await api.request(
        "PATCH /bots/:id/mcp/:name/tools/:tool",
        {
          classification: patch.classification ?? tool.classification ?? "writes",
          policy: patch.policy ?? tool.policy ?? "needs_approval",
        },
        { id: botId, name: server.name, tool: tool.name },
      )
      if (mounted.current) onUpdate(result.server)
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <article className="screen-card screen-policy-card">
      <div className="screen-card-heading">
        <div>
          <h3>{server.name}</h3>
          <p>
            {server.transport === "http" ? "Conexão HTTP" : "Processo local"} · {server.tools.length}{" "}
            {server.tools.length === 1 ? "ferramenta" : "ferramentas"}
          </p>
        </div>
        <span className="screen-status is-success">Configurado</span>
      </div>
      {server.tools.length === 0 ? (
        <ScreenState
          kind="empty"
          title="Nenhuma ferramenta anunciada"
          description="Confira a configuração do servidor para disponibilizar suas ferramentas."
        />
      ) : (
        <div className="screen-table-scroll">
          <table className="screen-policy-table">
            <caption className="visually-hidden">Políticas de ferramentas de {server.name}</caption>
            <thead>
              <tr>
                <th scope="col">Ferramenta</th>
                <th scope="col">Acesso</th>
                <th scope="col">Política</th>
              </tr>
            </thead>
            <tbody>
              {server.tools.map((tool) => (
                <tr key={tool.name}>
                  <th scope="row">
                    <code>{tool.name}</code>
                    {tool.description && <p>{localizeNotice(tool.description)}</p>}
                  </th>
                  <td>
                    <select
                      aria-label={`Classificação · ${tool.name}`}
                      disabled={busy}
                      value={tool.classification ?? "writes"}
                      onChange={(event) =>
                        void update(tool, { classification: event.target.value as "reads" | "writes" })
                      }
                    >
                      <option value="reads">Leitura</option>
                      <option value="writes">Escrita</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Política · ${tool.name}`}
                      disabled={busy}
                      value={tool.policy ?? "needs_approval"}
                      onChange={(event) => void update(tool, { policy: event.target.value as McpToolPolicy })}
                    >
                      <option value="always_allow">Sempre permitir</option>
                      <option value="needs_approval">Pedir aprovação</option>
                      <option value="blocked">Bloquear</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failed && (
        <p className="screen-inline-error" role="alert">
          Não foi possível salvar a política. Tente novamente selecionando a opção desejada.
        </p>
      )}
    </article>
  )
}
