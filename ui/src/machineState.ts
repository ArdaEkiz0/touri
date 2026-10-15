import type { MachineState } from "@touri/contracts"
import { userFacingError } from "./errors"

/** Older machine snapshots stored a stopped turn as an error. Keep that out of recovery UI. */
export const machineStateForDisplay = (state: MachineState | undefined): MachineState | undefined => {
  // r8 panel: a canceled turn is not a machine state, including in the shared header.
  if (!state) return state
  const canceled = Boolean(
    state.error &&
      (/^(?:canceled:\s*)?(?:Error:\s*)*(?:Turno cancelado|Cancelado por você)(?:\s.*)?$/i.test(
        userFacingError(state.error),
      ) ||
        /\[TOURI-E1007\]$/.test(state.error.trim())),
  )
  const canceledProgress = Boolean(
    state.progress && /^(?:Cancelado(?: por você)?|Turno cancelado|Canceled|Cancelled)$/i.test(state.progress.trim()),
  )
  if (!canceled && !canceledProgress) return state
  const status = canceled && state.status === "error" ? "stopped" : state.status
  return {
    ...state,
    status,
    progress:
      status === "stopped"
        ? "O computador está parado. Ligue para acessar a área de trabalho."
        : canceledProgress
          ? null
          : state.progress,
    error: canceled ? null : state.error,
  }
}
