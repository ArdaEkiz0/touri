import type { MachineState } from "@touri/contracts"
import { useState } from "react"
import type { UiApi } from "../api/client"
import { userFacingError } from "../errors"
import { localizeNotice, machineStatusLabel, t } from "../i18n"
import { MachineServiceButton } from "./MachineServiceButton"

export const MachineStatus = ({
  machine,
  turnFailed,
  api,
}: {
  machine: MachineState
  turnFailed: boolean
  api: UiApi
}) => {
  const [starting, setStarting] = useState(false)
  const inactivityPaused = machine.status === "stopped" && machine.pauseReason === "inactivity"
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const independent =
    machine.status === "starting" && turnFailed && machine.progress !== "Iniciando serviço de máquinas…"
  const explanation = "A máquina continua sendo preparada para o visualizador ou o próximo turno."
  const serviceDown =
    machine.errorCode === "TOURI-E8001" ||
    machine.errorCode === "TOURI-E8002" ||
    /TOURI-E800[12]/.test(machine.error ?? "")
  const stop = async () => {
    if (stopping) return
    setStopping(true)
    setError(null)
    try {
      await api.request("POST /bots/:id/machine/stop", {}, { id: machine.botId })
    } catch (failure) {
      setError(userFacingError(failure))
    } finally {
      setStopping(false)
    }
  }
  return (
    <div className="machine-turn-status" role="status" aria-live="polite">
      <span className={`machine-chip machine-${machine.status}`} title={independent ? explanation : undefined}>
        {t("Machine status", { status: machineStatusLabel(machine.status, machine.pauseReason) })}
      </span>
      {inactivityPaused && (
        <>
          <span>Máquina pausada por inatividade</span>
          <button
            className="button button-quiet"
            type="button"
            disabled={starting}
            onClick={() => {
              setStarting(true)
              setError(null)
              void api
                .request("POST /bots/:id/machine/intent", { intent: "computer-open" }, { id: machine.botId })
                .catch((failure) => setError(userFacingError(failure)))
                .finally(() => setStarting(false))
            }}
          >
            {starting ? "Ligando…" : "Ligar"}
          </button>
        </>
      )}
      {independent ? (
        <span className="machine-progress">{explanation}</span>
      ) : (
        machine.progress && <span className="machine-progress">{machine.progress}</span>
      )}
      {machine.error && (
        <span>
          {machine.status !== "error" ? "Erro anterior: " : ""}
          {localizeNotice(machine.error)}
        </span>
      )}
      {serviceDown && <MachineServiceButton api={api} botId={machine.botId} />}
      {independent && (
        <button type="button" className="button button-quiet" disabled={stopping} onClick={() => void stop()}>
          {stopping ? "Parando máquina…" : "Parar máquina"}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
