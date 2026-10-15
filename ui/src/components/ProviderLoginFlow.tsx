import { t } from "../i18n"
import type { useProviderLogin } from "../useProviderLogin"

export const ProviderLoginFlow = ({ login }: { login: ReturnType<typeof useProviderLogin> }) => {
  const { flow, error, busy, act } = login
  return (
    <div className="provider-login-flow">
      <p aria-live="polite">
        {!flow
          ? t("Verificando login…")
          : flow.state === "waiting"
            ? t("Aguardando login no navegador…")
            : flow.state === "ready"
              ? t("Login disponível para este bot.")
              : flow.state === "host-available"
                ? t("Há um login disponível neste Mac.")
                : flow.state === "cancelled"
                  ? t("Login cancelado.")
                  : flow.state === "error"
                    ? t("Não foi possível concluir o login. Tente novamente ou cole o token manualmente.")
                    : t("Entre no provedor para enviar mensagens.")}
      </p>
      {flow?.state === "waiting" && (
        <>
          {flow.prompt && (
            <div>
              <p>
                {flow.prompt.kind === "provider" ? t("Escolha a conta no OpenCode") : t("Escolha o método de login")}:{" "}
                <strong>{flow.prompt.choice}</strong>
              </p>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy}
                onClick={() => void act("input", undefined, "up")}
              >
                {t("Opção anterior")}
              </button>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy}
                onClick={() => void act("input", undefined, "down")}
              >
                {t("Próxima opção")}
              </button>
              <button
                type="button"
                className="button button-brand"
                disabled={busy}
                onClick={() => void act("input", undefined, "enter")}
              >
                {t("Confirmar opção")}
              </button>
            </div>
          )}
          {flow.deviceCode && (
            <p>
              {t("Código de login")}: <strong>{flow.deviceCode}</strong>
            </p>
          )}
          {flow.verificationUrl && (
            <a
              href={flow.verificationUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault()
                if (flow.verificationUrl) void login.openPage(flow.verificationUrl)
              }}
            >
              {t("Abrir página de login")}
            </a>
          )}
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => void act("cancel")}>
            {t("Cancelar login")}
          </button>
        </>
      )}
      {flow?.state === "host-available" && (
        <button type="button" className="button button-brand" disabled={busy} onClick={() => void act("use-host")}>
          {t("Usar login deste Mac")}
        </button>
      )}
      {flow && flow.state !== "waiting" && flow.state !== "ready" && (
        <button type="button" className="button button-quiet" disabled={busy} onClick={() => void act("start")}>
          {t("Entrar no navegador")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
