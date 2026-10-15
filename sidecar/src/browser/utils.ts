import { sleep as policySleep } from "../kernel/policy"
import type { JsonObject } from "./types"

export const asRecord = (value: unknown): JsonObject | null => {
  if (typeof value !== "object" || value === null) return null
  return value as JsonObject
}

export const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)

export const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

export const asBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null)

export const asArray = (value: unknown): Array<unknown> => (Array.isArray(value) ? value : [])

export const propertyValue = (value: unknown): unknown => {
  const record = asRecord(value)
  return record?.value
}

export const stringProperty = (value: unknown): string => asString(propertyValue(value)) ?? ""

export const numberProperty = (value: unknown): number | null => asNumber(propertyValue(value))

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> => policySleep(ms, signal)

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export type BudgetRace<T> = { timedOut: true } | { timedOut: false; value: T }

/** Awaits work for at most `ms`; the late result of abandoned work is swallowed. */
export const raceBudget = async <T>({
  work,
  ms,
  signal,
}: {
  work: Promise<T>
  ms: number
  signal?: AbortSignal
}): Promise<BudgetRace<T>> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const expired = new Promise<BudgetRace<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(1, ms))
  })
  const aborted = new Promise<never>((_, reject) => {
    if (signal?.aborted) reject(new Error("Operation aborted"))
    signal?.addEventListener("abort", () => reject(new Error("Operation aborted")), { once: true })
  })
  work.catch(() => undefined)
  aborted.catch(() => undefined)
  try {
    return await Promise.race([work.then((value): BudgetRace<T> => ({ timedOut: false, value })), expired, aborted])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
