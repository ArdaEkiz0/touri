import { expect, spyOn, test } from "bun:test"
import {
  backoffDelay,
  type Clock,
  deadline,
  debounce,
  expiryAt,
  isExpired,
  isIdle,
  poll,
  retry,
  sleep,
  withDeadline,
} from "../../src/kernel/policy"

test("deadlines, idle and expiry share inclusive boundaries without wall-clock dependencies", () => {
  let at = 10
  const clock: Clock = { now: () => at, sleep }
  const budget = deadline({ timeoutMs: 100, clock })
  expect(budget.remaining()).toBe(100)
  at = 110
  expect(budget.expired()).toBe(true)
  at = 200
  expect(budget.remaining()).toBe(0)
  expect(isIdle({ now: 20, lastActivityAt: 10, idleMs: 10 })).toBe(true)
  expect(isIdle({ now: 9, lastActivityAt: 10, idleMs: 10 })).toBe(false)
  expect(expiryAt({ now: 10, ttlMs: 20 })).toBe(30)
  expect(isExpired({ now: 30, expiresAt: 30 })).toBe(true)
  expect(isExpired({ now: 29, expiresAt: 30 })).toBe(false)
  expect(() => deadline({ timeoutMs: Infinity })).toThrow()
})

test("backoff grows exponentially, jitters deterministically and stays capped", () => {
  expect(backoffDelay({ attempt: 1, initialMs: 100, jitter: 0.5, random: () => 0 })).toBe(50)
  expect(backoffDelay({ attempt: 2, initialMs: 100, jitter: 0.5, random: () => 1 })).toBe(300)
  expect(backoffDelay({ attempt: 100, maxMs: 500, random: () => 1 })).toBe(500)
  expect(() => backoffDelay({ attempt: 0 })).toThrow()
  expect(() => backoffDelay({ attempt: 1, jitter: NaN })).toThrow()
  expect(() => backoffDelay({ attempt: 1, random: () => NaN })).toThrow()
  expect(backoffDelay({ attempt: 10_000, initialMs: 0 })).toBe(0)
})

test("retry stops on success, rejection policy or the exact attempt limit", async () => {
  const waits: Array<number> = []
  const clock: Clock = {
    now: () => 0,
    sleep: async (ms) => {
      waits.push(ms)
    },
  }
  const failure = new Error("transient")
  const attempted: Array<number> = []
  expect(
    await retry({
      clock,
      jitter: 0,
      operation: async (attempt) => {
        attempted.push(attempt)
        if (attempt < 3) throw failure
        return "ok"
      },
    }),
  ).toBe("ok")
  expect(attempted).toEqual([1, 2, 3])
  expect(waits).toEqual([100, 200])
  let calls = 0
  await expect(
    retry({
      clock,
      attempts: 5,
      shouldRetry: () => false,
      operation: async () => {
        calls += 1
        throw failure
      },
    }),
  ).rejects.toBe(failure)
  expect(calls).toBe(1)
  calls = 0
  await expect(
    retry({
      clock,
      attempts: 2,
      operation: async () => {
        calls += 1
        throw failure
      },
    }),
  ).rejects.toBe(failure)
  expect(calls).toBe(2)
})

test("sleep cleans abort listeners on completion and cancellation", async () => {
  const controller = new AbortController()
  const removed = spyOn(controller.signal, "removeEventListener")
  try {
    await sleep(1, controller.signal)
    expect(removed).toHaveBeenCalledTimes(1)
    const pending = sleep(1000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: "TOURI-E1007" })
    expect(removed).toHaveBeenCalledTimes(2)
  } finally {
    removed.mockRestore()
  }
})

test("deadline aborts cooperative work and rejects even when work ignores cancellation", async () => {
  let workSignal: AbortSignal | null = null
  await expect(
    withDeadline({
      timeoutMs: 5,
      operation: (signal) => {
        workSignal = signal
        return new Promise<never>(() => undefined)
      },
    }),
  ).rejects.toMatchObject({ code: "TOURI-E1008" })
  expect((workSignal as AbortSignal | null)?.aborted).toBe(true)
  const controller = new AbortController()
  const pending = withDeadline({
    timeoutMs: 1000,
    signal: controller.signal,
    operation: async () => new Promise<never>(() => undefined),
  })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: "TOURI-E1007" })
  expect(await withDeadline({ timeoutMs: 1000, operation: async () => "done" })).toBe("done")
})

test("retry never starts after cancellation during backoff", async () => {
  const controller = new AbortController()
  let attempts = 0
  await expect(
    retry({
      signal: controller.signal,
      clock: {
        now: () => 0,
        sleep: async () => {
          controller.abort()
        },
      },
      operation: async () => {
        attempts += 1
        throw new Error("transient")
      },
    }),
  ).rejects.toMatchObject({ code: "TOURI-E1007" })
  expect(attempts).toBe(1)
})

test("deadline rejects with its deadline code when cooperative work aborts", async () => {
  await expect(withDeadline({ timeoutMs: 5, operation: (signal) => sleep(1000, signal) })).rejects.toMatchObject({
    code: "TOURI-E1008",
  })
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await expect(
    withDeadline({
      timeoutMs: 100,
      signal: controller.signal,
      operation: async () => {
        calls += 1
      },
    }),
  ).rejects.toMatchObject({ code: "TOURI-E1007" })
  expect(calls).toBe(0)
  await expect(
    withDeadline({
      timeoutMs: 0,
      operation: async () => {
        calls += 1
      },
    }),
  ).rejects.toMatchObject({ code: "TOURI-E1008" })
  expect(calls).toBe(0)
  const beforeStart = new AbortController()
  const pending = withDeadline({
    timeoutMs: 100,
    signal: beforeStart.signal,
    operation: async () => {
      calls += 1
    },
  })
  beforeStart.abort()
  await expect(pending).rejects.toMatchObject({ code: "TOURI-E1007" })
  expect(calls).toBe(0)
})

test("poll rejects a result completed after its budget and honors cancellation", async () => {
  let at = 0
  expect(
    await poll({
      timeoutMs: 10,
      clock: { now: () => at, sleep },
      probe: async () => {
        at = 11
        return "late"
      },
      accept: () => true,
    }),
  ).toBeNull()
  const controller = new AbortController()
  const pending = poll({
    timeoutMs: 1000,
    signal: controller.signal,
    probe: async () => new Promise<never>(() => undefined),
    accept: () => true,
  })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ code: "TOURI-E1007" })
})

test("poll succeeds with an injected clock and never probes after the budget expires", async () => {
  let at = 0
  let probes = 0
  const clock: Clock = {
    now: () => at,
    sleep: async (ms, signal) => {
      if (signal) await sleep(ms, signal)
      else at += ms
    },
  }
  expect(
    await poll({ clock, timeoutMs: 100, intervalMs: 10, probe: async () => ++probes, accept: (value) => value === 3 }),
  ).toBe(3)
  expect(at).toBe(20)
  probes = 0
  at = 0
  expect(
    await poll({ clock, timeoutMs: 25, intervalMs: 10, probe: async () => ++probes, accept: () => false }),
  ).toBeNull()
  expect(probes).toBe(3)
  expect(at).toBe(25)
  expect(
    await poll({ timeoutMs: 5, probe: async () => new Promise<never>(() => undefined), accept: () => false }),
  ).toBeNull()
})

test("debounce replaces pending arguments, flushes once and cancels without executing", () => {
  const queued = new Map<number, () => void>()
  let id = 0
  const values: Array<string> = []
  const delivery = debounce({
    waitMs: 20,
    callback: (value: string) => values.push(value),
    scheduler: {
      schedule: (callback, ms) => {
        expect(ms).toBe(20)
        const key = ++id
        queued.set(key, callback)
        return () => {
          queued.delete(key)
        }
      },
    },
  })
  delivery.call("first")
  delivery.call("last")
  expect(queued.size).toBe(1)
  expect(delivery.pending()).toBe(true)
  for (const callback of queued.values()) callback()
  expect(values).toEqual(["last"])
  delivery.flush()
  delivery.call("flush")
  delivery.flush()
  delivery.call("discard")
  delivery.cancel()
  expect(values).toEqual(["last", "flush"])
  expect(delivery.pending()).toBe(false)
  expect(queued.size).toBe(0)
})
