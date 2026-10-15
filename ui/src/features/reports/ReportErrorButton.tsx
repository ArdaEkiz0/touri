import { useState } from "react"
import { createApiClient, createTauriInvoke, resolveSidecarEndpoint, type UiApi, webEndpoint } from "../../api/client"
import { Modal } from "../../components/Modals"
import { ReportProblem } from "./ReportProblem"

export const problemErrorCode = (message: string, fallback = "TOURI-E1000") =>
  message.match(/TOURI-E\d{4}/)?.[0] ?? fallback
export const ReportErrorButton = ({
  api,
  message,
  fallbackCode,
}: {
  api?: UiApi | undefined
  message: string
  fallbackCode?: string
}) => {
  const [open, setOpen] = useState(false)
  const [resolved, setResolved] = useState<UiApi | undefined>(api)
  const [resolving, setResolving] = useState(false)
  const show = async () => {
    setResolving(true)
    if (!api) {
      try {
        const endpoint =
          "__TAURI_INTERNALS__" in window
            ? await resolveSidecarEndpoint(createTauriInvoke())
            : webEndpoint(window.location)
        const client = createApiClient({ endpoint })
        await client.request("GET /health", {})
        setResolved(client)
      } catch {
        setResolved(undefined)
      }
    }
    setResolving(false)
    setOpen(true)
  }
  return (
    <>
      <button className="button button-quiet" type="button" disabled={resolving} onClick={() => void show()}>
        {resolving ? "Preparando relatório…" : "Reportar este problema"}
      </button>
      {open && (
        <Modal title="Reportar problema" className="settings-modal" onClose={() => setOpen(false)}>
          <div className="report-dialog-content">
            <ReportProblem
              api={resolved}
              errorCode={problemErrorCode(message, fallbackCode)}
              errorMessage={message}
              offline={!resolved}
            />
          </div>
        </Modal>
      )}
    </>
  )
}
