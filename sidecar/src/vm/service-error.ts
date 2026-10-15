import { isErrorCode, publicError } from "@touri/contracts"
import type { VmProviderErrorCode } from "./types"

/** Preserve the machine cause through preparation and the turn's error boundary. */
export class MachineServiceError extends Error {
  readonly errorCode: "machine_service_unavailable" | "machine_service_start_failed"
  readonly code: "TOURI-E8001" | "TOURI-E8002"

  constructor(errorCode: "MACHINE_SERVICE_UNAVAILABLE" | "MACHINE_SERVICE_START_FAILED", detail: string) {
    super(detail)
    this.errorCode =
      errorCode === "MACHINE_SERVICE_UNAVAILABLE" ? "machine_service_unavailable" : "machine_service_start_failed"
    this.code = errorCode === "MACHINE_SERVICE_UNAVAILABLE" ? "TOURI-E8001" : "TOURI-E8002"
  }
}

export const isMachineServiceFailure = (
  code: string,
): code is Extract<VmProviderErrorCode, "MACHINE_SERVICE_UNAVAILABLE" | "MACHINE_SERVICE_START_FAILED"> =>
  code === "MACHINE_SERVICE_UNAVAILABLE" || code === "MACHINE_SERVICE_START_FAILED"

export const machineErrorState = (error: unknown) =>
  error instanceof MachineServiceError
    ? { errorCode: error.code, error: `${publicError(error.code).error} [${error.code}]` }
    : {
        errorCode: error instanceof Error && "code" in error && isErrorCode(error.code) ? error.code : null,
        error: error instanceof Error ? error.message : String(error),
      }
