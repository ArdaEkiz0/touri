import { delay } from "./utils"

const DATABASE_LOCKED = /database is locked|SQLITE_BUSY|database table is locked/i
const SERVICE_DOWN = /failed to list containers|XPC connection|Connection invalid|container system (?:service|start)/i
const DATABASE_DELAYS_MS: ReadonlyArray<number> = [500, 1_500, 4_000]
const SERVICE_DELAYS_MS: ReadonlyArray<number> = [2_000]

const delaysFor = (message: string): ReadonlyArray<number> => {
  if (DATABASE_LOCKED.test(message)) return DATABASE_DELAYS_MS
  if (SERVICE_DOWN.test(message)) return SERVICE_DELAYS_MS
  return []
}

export type RetryTransientArgs<T> = {
  run: () => Promise<T>
  failureOf: (value: T) => string | null
  canRetry: () => boolean
  signal: AbortSignal
}

/** Re-run an operation that failed with a transient cause (locked database, container service blip) with backoff. */
export const retryTransient = async <T>({ run, failureOf, canRetry, signal }: RetryTransientArgs<T>): Promise<T> => {
  const attempt = async (retriesUsed: number): Promise<T> => {
    const value = await run()
    const message = failureOf(value)
    const delays = message ? delaysFor(message) : []
    const wait = delays[retriesUsed]
    if (wait === undefined || signal.aborted || !canRetry()) return value
    await delay({ milliseconds: wait, signal }).catch(() => undefined)
    return attempt(retriesUsed + 1)
  }
  return attempt(0)
}
