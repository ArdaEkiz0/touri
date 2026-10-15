import { useEffect, useState } from "react"
import type { UiApi } from "../api/client"
import { SettingsRow, SettingsSwitch } from "./SettingsLayout"

type Policy = { allowLan: boolean; resolvers: string[]; privateDomains: string[] }
type Status = { requested: Policy; active: Policy }
export const BotNetworkSettings = ({ api, botId }: { api: UiApi; botId: string }) => {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [resolvers, setResolvers] = useState("")
  // VM-specific settings live outside bot/schema records and use the same authenticated client.
  const request = api.request as unknown as (
    route: string,
    body: unknown,
    params: Record<string, string>,
  ) => Promise<Status>
  useEffect(() => {
    let live = true
    void request("GET /bots/:id/network-policy", {}, { id: botId })
      .then((value) => {
        if (live) {
          setStatus(value)
          setResolvers(value.requested.resolvers.join(", "))
        }
      })
      .catch(() => {
        if (live) setError("Não foi possível ler a proteção de rede.")
      })
    return () => {
      live = false
    }
  }, [request, botId])
  const save = async (policy: Policy) => {
    setBusy(true)
    setError("")
    try {
      setStatus(await request("PUT /bots/:id/network-policy", policy, { id: botId }))
    } catch {
      setError("Não foi possível salvar a proteção de rede. Verifique a máquina.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Proteção de rede">
      <SettingsRow
        title="Permitir acesso à rede local"
        description="Desativado por padrão. Bloqueios entram em vigor agora; permissões adicionais só após reiniciar a máquina. O host e endereços de metadados continuam bloqueados."
      >
        <SettingsSwitch
          aria-label="Permitir acesso à rede local"
          checked={status?.requested.allowLan ?? false}
          disabled={!status || busy}
          onChange={(event) => {
            if (status) void save({ ...status.requested, allowLan: event.target.checked })
          }}
        />
      </SettingsRow>
      {status && (
        <label>
          Servidores DNS (IPs separados por vírgula)
          <input
            value={resolvers}
            disabled={busy}
            onChange={(event) => setResolvers(event.target.value)}
            onBlur={() => {
              const list = resolvers
                .split(",")
                .map((ip) => ip.trim())
                .filter(Boolean)
              if (list.join(",") !== status.requested.resolvers.join(","))
                void save({ ...status.requested, resolvers: list })
            }}
          />
        </label>
      )}
      <p className="muted">Consultas a nomes locais e privados são bloqueadas antes de sair da máquina.</p>
      <p className="muted">
        Máquinas criadas em versões anteriores também começam com a rede local bloqueada. Se este bot acessa servidores
        da sua rede, ative a opção acima, reinicie a máquina e use o endereço IP do servidor em vez de nomes como .local
        ou .lan.
      </p>
      {status &&
        ((status.requested.allowLan && !status.active.allowLan) ||
          status.requested.resolvers.some((ip) => !status.active.resolvers.includes(ip)) ||
          status.active.privateDomains.some((domain) => !status.requested.privateDomains.includes(domain))) && (
          <p role="status">Reinicie a máquina para aplicar as permissões adicionais de rede.</p>
        )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
