import type { AppSettings } from "@touri/contracts"
import { useEffect, useState } from "react"
import type { UiApi } from "../../api/client"
import { SettingsGroup, SettingsRow } from "../../components/SettingsLayout"
import { userFacingError } from "../../errors"
import { CloudLink, openCloudLink } from "./CloudLink"
import { cloudBytes, cloudHours, useCloudAccount } from "./useCloudAccount"
import "./cloud.css"

export const CloudPreferences = ({
  api,
  settings,
  onSave,
}: {
  api: UiApi
  settings: AppSettings
  onSave: (patch: Partial<AppSettings>) => Promise<void>
}) => {
  const { account, setAccount, error, setError, refresh } = useCloudAccount(api, settings.cloud === true)
  const [baseUrl, setBaseUrl] = useState(settings.cloudBaseUrl ?? "")
  const [busy, setBusy] = useState(false)
  const pairing = account?.pairing
  const pairingCode = pairing?.userCode
  const pollInterval = pairing?.intervalSeconds
  useEffect(() => {
    if (!pairingCode) return
    let active = true
    const timer = setInterval(
      () => {
        void api
          .request("POST /cloud/pair/poll", {})
          .then((value) => {
            if (active) {
              setAccount(value)
              setError(null)
            }
          })
          .catch((reason) => {
            if (active) {
              setError(userFacingError(reason))
              clearInterval(timer)
            }
          })
      },
      Math.max(5, pollInterval ?? 5) * 1000,
    )
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [api, pairingCode, pollInterval, setAccount, setError])
  const action = async (connect: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (connect) {
        await onSave({ cloudBaseUrl: baseUrl.trim() })
        const value = await api.request("POST /cloud/pair", {})
        setAccount((prior) => (prior ? { ...prior, pairing: value } : prior))
        await openCloudLink(value.verificationUri)
      } else await api.request("DELETE /cloud/account", {})
      await refresh()
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="cloud-preferences">
      <div className="settings-inline-note">
        <strong>Sua conta Touri na nuvem</strong>
        <p>
          Execução na nuvem chega em breve. Você fornece sua chave API e paga o modelo diretamente ao provedor. O uso
          local continua grátis e sem conta.
        </p>
      </div>
      <SettingsGroup title="Conta">
        <SettingsRow
          title="Servidor de nuvem"
          description="Endereço do serviço compatível com o protocolo público v1."
          htmlFor="cloud-url"
        >
          <input
            id="cloud-url"
            type="url"
            placeholder="https://seu-servidor.example"
            value={baseUrl}
            disabled={account?.connected || busy || !!pairing}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          title={
            account?.connected
              ? (account.account?.email ?? account.account?.name ?? "Conta conectada")
              : "Entrar em uma conta"
          }
          description={
            account?.connected
              ? "Desvincular este aparelho mantém sua assinatura e os dados dos bots."
              : "Confirme o código no navegador para autorizar este aparelho."
          }
        >
          <button
            className="button button-quiet"
            type="button"
            disabled={busy || (!account?.connected && (!baseUrl.trim() || !!pairing))}
            onClick={() => void action(!account?.connected)}
          >
            {busy ? "Aguarde…" : account?.connected ? "Desvincular aparelho" : "Entrar em uma conta"}
          </button>
        </SettingsRow>
      </SettingsGroup>
      {pairing && (
        <div className="cloud-pairing" role="status">
          <span>Código de pareamento</span>
          <strong>{pairing.userCode}</strong>
          <CloudLink
            className="button button-brand"
            href={pairing.verificationUri}
            onError={(error) => setError(userFacingError(error))}
          >
            Confirmar no navegador
          </CloudLink>
          <small>
            Expira às {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
            Aguardando confirmação…
          </small>
        </div>
      )}
      {account?.connected && account.plan && account.usage && (
        <>
          <SettingsGroup title="Plano e uso">
            <SettingsRow
              title={account.plan.name}
              description={`R$ ${(account.plan.priceCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês · ${{ active: "Ativo", pending: "Pendente", past_due: "Inadimplente", suspended: "Inadimplente", canceled: "Cancelado" }[account.plan.status]}`}
            >
              <CloudLink
                className="button button-quiet"
                href={account.plan.subscribeUrl}
                onError={(error) => setError(userFacingError(error))}
              >
                Assinar na web
              </CloudLink>
            </SettingsRow>
            <SettingsRow
              title="Horas de computador"
              description={`${cloudHours(account.usage.usedSeconds)} de ${cloudHours(account.usage.includedSeconds)}`}
            >
              <progress
                max={Math.max(1, account.usage.includedSeconds)}
                value={account.usage.usedSeconds}
                aria-label="Franquia de horas utilizada"
              />
            </SettingsRow>
            <SettingsRow
              title="Armazenamento"
              description={`${cloudBytes(account.usage.storageBytes)} de ${cloudBytes(account.usage.storageLimitBytes)}`}
            >
              <small>
                Atualizado às{" "}
                {new Date(account.usage.updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </small>
            </SettingsRow>
          </SettingsGroup>
          <p className="field-help">
            Sandbox · sem cobrança real. O plano mínimo é R$ 79,99/mês; o catálogo e a franquia vêm do servidor.
          </p>
        </>
      )}
      {error && (
        <p className="warning-callout" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
