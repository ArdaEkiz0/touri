import type { Kernel } from "@touri/contracts"

export class VmStageError extends Error {
  constructor(
    message: string,
    readonly errorCode: "timeout" | "canceled",
  ) {
    super(message)
  }
}

export const abortVmWait = <T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) return abort()
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted()
        return action()
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort))
  })

// Bound the wait itself, even when a host RPC or a provider never settles.
// Actions receive an abort signal so subprocesses and late continuations stop too.
export const vmStage = async <T>({
  kernel,
  botId,
  threadId,
  stage,
  timeoutMs,
  timeoutMessage,
  signal,
  action,
}: {
  kernel: Kernel
  botId: string
  threadId?: string
  stage: string
  timeoutMs: number
  timeoutMessage: string
  signal?: AbortSignal
  action: (signal: AbortSignal) => Promise<T>
}): Promise<T> => {
  const started = Date.now()
  const data = { botId, threadId, stage }
  const controller = new AbortController()
  const cancel = () =>
    controller.abort(
      signal?.reason instanceof VmStageError ? signal.reason : new VmStageError("Turno cancelado", "canceled"),
    )
  signal?.addEventListener("abort", cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new VmStageError(timeoutMessage, "timeout")), timeoutMs)
  kernel.log({ level: "info", module: "vm", msg: `VM ${stage}: início`, data })
  try {
    const result = await abortVmWait(controller.signal, () => action(controller.signal))
    controller.signal.throwIfAborted()
    kernel.log({
      level: "info",
      module: "vm",
      msg: `VM ${stage}: concluído`,
      data: { ...data, durationMs: Date.now() - started },
    })
    return result
  } catch (error) {
    controller.abort(error)
    kernel.log({
      level: "error",
      module: "vm",
      msg: `VM ${stage}: falha`,
      data: {
        ...data,
        durationMs: Date.now() - started,
        error: kernel.redact(error instanceof Error ? error.message : String(error)),
      },
    })
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
  }
}
