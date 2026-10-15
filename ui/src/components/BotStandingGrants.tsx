import type { StandingGrant } from "@touri/contracts"
import { useEffect, useState } from "react"
import type { UiApi } from "../api/client"
import { userFacingError } from "../errors"

export const BotStandingGrants = ({ api, botId }: { api: UiApi; botId: string }) => {
  const [grants, setGrants] = useState<StandingGrant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api
      .request("GET /bots/:id/grants", {}, { id: botId })
      .then(({ grants }) => {
        if (active) setGrants(grants)
      })
      .catch((error) => {
        if (active) setError(userFacingError(error))
      })
    return () => {
      active = false
    }
  }, [api, botId])
  const revoke = async (grant: StandingGrant) => {
    setBusy(grant.id)
    setError(null)
    try {
      await api.request("DELETE /bots/:id/grants/:grant", {}, { id: botId, grant: grant.id })
      setGrants((current) => current.filter((value) => value.id !== grant.id))
    } catch (error) {
      setError(userFacingError(error))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="bot-mcp-settings" aria-label="Permissões permanentes">
      <h3>Permissões permanentes</h3>
      <p>
        Estas ferramentas podem agir sem pedir novamente neste bot. Revogue uma permissão para voltar a aprovar cada
        ação.
      </p>
      {grants.length === 0 && <p>Nenhuma permissão permanente concedida.</p>}
      {grants.map((grant) => (
        <article key={grant.id}>
          <strong>
            {grant.scope.server ? `${grant.scope.server} · ` : ""}
            {grant.scope.tool}
          </strong>
          <small>
            {grant.scope.source === "computer"
              ? "Controle do computador"
              : grant.scope.source === "opencode"
                ? "Permissão do OpenCode"
                : grant.scope.source === "claude"
                  ? "Permissão do Claude"
                  : "Ferramenta MCP"}
          </small>
          <button type="button" className="text-button" disabled={busy !== null} onClick={() => void revoke(grant)}>
            Revogar
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
