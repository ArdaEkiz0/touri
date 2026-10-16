import type { MachineState } from "@touri/contracts"
import { useState } from "react"
import type { UiApi } from "../api/client"
import { userFacingError } from "../errors"
import { localizeNotice, machineStatusLabel, t } from "../i18n"
import { MachineServiceButton } from "./MachineServiceButton"
import { MachineStopButton } from "./MachineStopButton"

export const MachineStatus = ({
  machine,
  turnFailed,
  api,
  activeTurns = false,
}: {
  machine: MachineState
  turnFailed: boolean
  api: UiApi
  activeTurns?: boolean
}) => {
  const [starting, setStarting] = useState(false)
  const inactivityPaused = machine.status === "stopped" && machine.pauseReason === "inactivity"
  const [error, setError] = useState<string | null>(null)
  const independent =
    machine.status === "starting" && turnFailed && machine.progress !== "Iniciando serviço de máquinas…"
  const explanation = "A máquina continua sendo preparada para o visualizador ou o próximo turno."
  const serviceDown =
    machine.errorCode === "TOURI-E8001" ||
    machine.errorCode === "TOURI-E8002" ||
    /TOURI-E800[12]/.test(machine.error ?? "")
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
      {(machine.status === "running" || independent) && (
        <MachineStopButton api={api} botId={machine.botId} activeTurns={activeTurns} />
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
