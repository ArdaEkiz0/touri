import { sleep } from "../kernel/policy"
import { MachineServiceError } from "./service-error"
import { abortVmWait } from "./stage"

export const MACHINE_SERVICE_WAIT_MS = 30_000
const BACKOFF_MS = [250, 500, 1_000, 2_000]

const unavailable = (error: unknown): error is MachineServiceError =>
  error instanceof MachineServiceError && error.errorCode === "machine_service_unavailable"

/** Keep service recovery bounded without charging healthy image/guest boot time to its budget. */
export const withMachineServiceRecovery = async <T>({
  action,
  probe,
  startService,
  onWaiting,
  signal,
  timeoutMs = MACHINE_SERVICE_WAIT_MS,
}: {
  action: () => Promise<T>
  probe: (signal: AbortSignal) => Promise<void>
  startService: () => Promise<unknown>
  onWaiting: () => void
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<T> => {
  let deadline: number | undefined
  let requestedStart = false
  let retries = 0
  while (true) {
    signal?.throwIfAborted()
    try {
      return await action()
    } catch (error) {
      signal?.throwIfAborted()
      if (!unavailable(error)) throw error
      deadline ??= performance.now() + timeoutMs
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw error
      onWaiting()
      const controller = new AbortController()
      const waiting = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      const timer = setTimeout(() => controller.abort(error), remaining)
      try {
        await abortVmWait(waiting, async () => {
          if (!requestedStart) {
            requestedStart = true
            // A failed start can race with launchd or a manual start. Keep probing.
            await startService().catch(() => undefined)
          }
          while (true) {
            waiting.throwIfAborted()
            await sleep(BACKOFF_MS[Math.min(retries++, BACKOFF_MS.length - 1)] ?? 2_000, waiting)
            waiting.throwIfAborted()
            try {
              await probe(waiting)
              waiting.throwIfAborted()
              return
            } catch (failure) {
              waiting.throwIfAborted()
              if (!unavailable(failure)) throw failure
            }
          }
        })
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
