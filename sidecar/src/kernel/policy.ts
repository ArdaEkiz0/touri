import { TouriError } from "./errors"

export type Clock = { now: () => number; sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void> }

const duration = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("A duração deve ser finita e não negativa")
  return value
}

export const sleep = (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  duration(milliseconds)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TouriError("TOURI-E1007"))
      return
    }
    const done = (): void => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(done, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      reject(new TouriError("TOURI-E1007"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}

/** Durations use a monotonic clock; persisted timestamps keep using wall time. */
export const systemClock: Clock = { now: () => performance.now(), sleep }

export const isExpired = ({ now, expiresAt }: { now: number; expiresAt: number }): boolean => now >= expiresAt
export const expiryAt = ({ now, ttlMs }: { now: number; ttlMs: number }): number => now + duration(ttlMs)
export const isIdle = ({
  now,
  lastActivityAt,
  idleMs,
}: {
  now: number
  lastActivityAt: number
  idleMs: number
}): boolean => now - lastActivityAt >= duration(idleMs)

export const deadline = ({ timeoutMs, clock = systemClock }: { timeoutMs: number; clock?: Clock }) => {
  const expiresAt = expiryAt({ now: clock.now(), ttlMs: timeoutMs })
  return {
    expiresAt,
    remaining: (): number => Math.max(0, expiresAt - clock.now()),
    expired: (): boolean => isExpired({ now: clock.now(), expiresAt }),
  }
}

export const withDeadline = async <T>({
  operation,
  timeoutMs,
  signal,
  clock = systemClock,
}: {
  operation: (signal: AbortSignal) => Promise<T>
  timeoutMs: number
  signal?: AbortSignal
  clock?: Clock
}): Promise<T> => {
  duration(timeoutMs)
  if (signal?.aborted) throw new TouriError("TOURI-E1007")
  if (timeoutMs === 0) throw new TouriError("TOURI-E1008")
  const work = new AbortController()
  const timer = new AbortController()
  let cancel: () => void = () => undefined
  const canceled = new Promise<never>((_, reject) => {
    cancel = () => {
      work.abort()
      reject(new TouriError("TOURI-E1007"))
    }
    signal?.addEventListener("abort", cancel, { once: true })
  })
  const timeout = clock.sleep(timeoutMs, timer.signal).then(() => {
    work.abort()
    throw new TouriError("TOURI-E1008")
  })
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (work.signal.aborted) throw new TouriError("TOURI-E1007")
        return operation(work.signal)
      }),
      timeout,
      canceled,
    ])
  } finally {
    timer.abort()
    signal?.removeEventListener("abort", cancel)
  }
}

export type Backoff = { initialMs?: number; maxMs?: number; factor?: number; jitter?: number; random?: () => number }

export const backoffDelay = ({
  attempt,
  initialMs = 100,
  maxMs = 30_000,
  factor = 2,
  jitter = 0.2,
  random = Math.random,
}: Backoff & { attempt: number }): number => {
  duration(initialMs)
  duration(maxMs)
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !Number.isFinite(factor) ||
    factor < 1 ||
    jitter < 0 ||
    jitter > 1 ||
    !Number.isFinite(jitter)
  )
    throw new RangeError("Política de repetição inválida")
  const sample = random()
  if (!Number.isFinite(sample)) throw new RangeError("A amostra de aleatoriedade deve ser finita")
  const base = initialMs === 0 ? 0 : Math.min(maxMs, initialMs * factor ** (attempt - 1))
  return Math.min(maxMs, Math.max(0, base * (1 - jitter + 2 * jitter * Math.max(0, Math.min(1, sample)))))
}

export const retry = async <T>({
  operation,
  attempts = 3,
  shouldRetry = () => true,
  signal,
  clock = systemClock,
  ...backoff
}: Backoff & {
  operation: (attempt: number) => Promise<T>
  attempts?: number
  shouldRetry?: (error: unknown) => boolean
  signal?: AbortSignal
  clock?: Clock
}): Promise<T> => {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("O número de tentativas deve ser positivo")
  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) throw new TouriError("TOURI-E1007")
    try {
      return await operation(attempt)
    } catch (error) {
      if (signal?.aborted) throw new TouriError("TOURI-E1007")
      if (attempt >= attempts || !shouldRetry(error)) throw error
      await clock.sleep(backoffDelay({ ...backoff, attempt }), signal)
    }
  }
}

/** A single budget bounds probes and waits; no probe starts after expiry. */
export const poll = async <T>({
  probe,
  accept,
  timeoutMs,
  intervalMs = 50,
  signal,
  clock = systemClock,
}: {
  probe: () => Promise<T>
  accept: (value: T) => boolean
  timeoutMs: number
  intervalMs?: number
  signal?: AbortSignal
  clock?: Clock
}): Promise<T | null> => {
  if (duration(intervalMs) === 0) throw new RangeError("O intervalo deve ser positivo")
  const budget = deadline({ timeoutMs, clock })
  while (!budget.expired()) {
    if (signal?.aborted) throw new TouriError("TOURI-E1007")
    const value = await withDeadline({
      operation: probe,
      timeoutMs: budget.remaining(),
      clock,
      ...(signal ? { signal } : {}),
    }).catch((error: unknown) => {
      if (error instanceof TouriError && error.code === "TOURI-E1008") return null
      throw error
    })
    if (signal?.aborted) throw new TouriError("TOURI-E1007")
    if (budget.expired()) break
    if (value !== null && accept(value)) return value
    await clock.sleep(Math.min(intervalMs, budget.remaining()), signal)
  }
  return null
}

export type TimerScheduler = { schedule: (callback: () => void, milliseconds: number) => () => void }
const systemScheduler: TimerScheduler = {
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds)
    return () => clearTimeout(timer)
  },
}

export const debounce = <T extends Array<unknown>>({
  callback,
  waitMs,
  scheduler = systemScheduler,
}: {
  callback: (...args: T) => void
  waitMs: number
  scheduler?: TimerScheduler
}) => {
  duration(waitMs)
  let args: T | null = null
  let cancelTimer: (() => void) | null = null
  const cancel = (): void => {
    cancelTimer?.()
    cancelTimer = null
    args = null
  }
  const flush = (): void => {
    const pending = args
    cancel()
    if (pending) callback(...pending)
  }
  return {
    call: (...next: T): void => {
      cancel()
      args = next
      cancelTimer = scheduler.schedule(flush, waitMs)
    },
    cancel,
    flush,
    pending: (): boolean => args !== null,
  }
}
