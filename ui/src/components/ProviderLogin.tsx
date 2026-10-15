import type { ApiRoutes, Bot } from "@touri/contracts"
import { useCallback, useEffect, useState } from "react"
import type { UiApi } from "../api/client"
import { SETTINGS } from "../features/commandPalette/settingsRegistry"
import { t } from "../i18n"

export const ProviderLogin = ({
  api,
  botId,
  provider,
  onConfigured,
}: {
  api: UiApi
  botId: string
  provider: Bot["provider"]
  onConfigured: () => void
}) => {
  const [status, setStatus] = useState<ApiRoutes["GET /bots/:id/provider-login"]["res"] | null>(null)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; retrySave?: boolean } | null>(null)
  const refresh = useCallback(async () => {
    setError(null)
    try {
      setStatus(await api.request("GET /bots/:id/provider-login", {}, { id: botId }))
    } catch {
      setError({ message: t("Não foi possível verificar o login.") })
    }
  }, [api, botId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: discard the previous provider's login state when the draft provider changes
  useEffect(() => {
    setStatus(null)
    setError(null)
    setOpen(false)
    setValue("")
    void refresh()
  }, [refresh, provider])
  const save = async () => {
    if (busy || !value.trim() || status?.provider !== provider) return
    setBusy(true)
    setError(null)
    try {
      await api.request("PUT /bots/:id/provider-login", { value }, { id: botId })
      setValue("")
      setOpen(false)
      onConfigured()
      await refresh()
    } catch {
      setError({ message: t("Não foi possível salvar o login no cofre de segredos."), retrySave: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="provider-login"
      aria-label={t("Login do provedor nesta máquina")}
      data-setting-id={SETTINGS.providerLogin.id}
    >
      <label>
        Fonte do login
        <select
          id={SETTINGS.providerLogin.controlId}
          aria-label="Fonte do login"
          value={status?.configuredSource ?? "vault"}
          disabled={busy || (!!status && status.provider !== provider)}
          onChange={(event) => {
            const input = {
              value: "",
              source: event.target.value === "host-file" ? ("host-file" as const) : ("vault" as const),
            }
            setBusy(true)
            void api
              .request("PUT /bots/:id/provider-login", input, { id: botId })
              .then(refresh)
              .catch(() => setError({ message: "Não foi possível selecionar a fonte de login." }))
              .finally(() => setBusy(false))
          }}
        >
          <option value="vault">Cofre de segredos deste bot</option>
          <option value="host-file">Arquivo de login do host</option>
        </select>
      </label>
      <p role="status">
        {status && status.provider !== provider
          ? `Salve o provedor ${provider === "opencode" ? "OpenCode" : provider === "codex" ? "Codex" : "Claude"} para verificar e configurar seu login.`
          : (status?.message ?? t("Verificando login…"))}
      </p>
      <button
        type="button"
        className="button button-quiet"
        disabled={!!status && status.provider !== provider}
        onClick={() => setOpen(true)}
      >
        {t("Entrar no provedor nesta máquina", {
          provider: provider === "opencode" ? "OpenCode" : provider === "claude" ? "Claude" : "Codex",
        })}
      </button>
      {open && (
        <div>
          <p>
            {provider === "opencode"
              ? "Execute opencode auth login e cole o conteúdo de ~/.local/share/opencode/auth.json. O arquivo será compartilhado somente para leitura com esta máquina."
              : provider === "claude"
                ? t(
                    "Gere um token OAuth no terminal com claude setup-token e cole abaixo. Ele será usado somente nas execuções deste bot na VM.",
                  )
                : t(
                    'Execute codex -c cli_auth_credentials_store="file" login --device-auth no terminal e cole o conteúdo de ~/.codex/auth.json abaixo.',
                  )}
          </p>
          <label>
            {provider === "opencode"
              ? "Login JSON do OpenCode"
              : provider === "claude"
                ? t("Token OAuth do Claude")
                : t("Login JSON do Codex")}
            <input
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <div className="provider-login-actions">
            <button
              type="button"
              className="button button-brand"
              disabled={busy || !value.trim()}
              onClick={() => void save()}
            >
              {busy ? t("Salvando…") : t("Salvar login no cofre")}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setValue("")
                setOpen(false)
              }}
            >
              {t("Cancelar")}
            </button>
          </div>
        </div>
      )}
      {status?.ready && status.provider === provider && (
        <button
          type="button"
          className="text-button"
          onClick={() =>
            void api
              .request("DELETE /bots/:id/provider-login", {}, { id: botId })
              .then(refresh)
              .catch(() => setError({ message: t("Não foi possível remover o login.") }))
          }
        >
          {t("Remover login salvo deste bot")}
        </button>
      )}
      {error && <p role="alert">{error.message}</p>}
      {(error || (status?.provider === provider && status.health === "transport")) && (
        <button
          type="button"
          className="button button-quiet"
          disabled={busy}
          onClick={() => {
            if (error?.retrySave) void save()
            else {
              setBusy(true)
              void refresh().finally(() => setBusy(false))
            }
          }}
        >
          {t("Tentar de novo")}
        </button>
      )}
    </section>
  )
}
