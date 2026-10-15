import { expect, mock, test } from "bun:test"
import { MachineServiceError } from "../../src/vm/service-error"
import { MACHINE_SERVICE_WAIT_MS, withMachineServiceRecovery } from "../../src/vm/service-wait"

const serviceError = () => new MachineServiceError("MACHINE_SERVICE_UNAVAILABLE", "XPC connection invalid")
const deferred = () => {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("a healthy boot does not start or wait for the service", async () => {
  const startService = mock(async () => {})
  const probe = mock(async () => {})
  const onWaiting = mock(() => {})
  expect(MACHINE_SERVICE_WAIT_MS).toBe(30_000)
  expect(await withMachineServiceRecovery({ action: async () => "ready", startService, probe, onWaiting })).toBe(
    "ready",
  )
  expect(startService).not.toHaveBeenCalled()
  expect(probe).not.toHaveBeenCalled()
  expect(onWaiting).not.toHaveBeenCalled()
})

test("starts once, backs off through service failures and resumes the original boot", async () => {
  const action = mock(async () => {
    if (action.mock.calls.length === 1) throw serviceError()
    return "ready"
  })
  const times: number[] = []
  const probe = mock(async () => {
    times.push(performance.now())
    if (times.length < 3) throw serviceError()
  })
  const startService = mock(async () => ({ success: false, errorCode: "MACHINE_SERVICE_START_FAILED" }))
  const onWaiting = mock(() => {})
  expect(await withMachineServiceRecovery({ action, probe, startService, onWaiting, timeoutMs: 3_000 })).toBe("ready")
  expect(startService).toHaveBeenCalledTimes(1)
  expect(action).toHaveBeenCalledTimes(2)
  expect(onWaiting).toHaveBeenCalledTimes(1)
  expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(450)
  expect((times[2] ?? 0) - (times[1] ?? 0)).toBeGreaterThanOrEqual(950)
})

test("only gives up with the original E8001 when the service budget expires", async () => {
  const error = serviceError()
  const action = mock(async () => {
    throw error
  })
  const probe = mock(async () => {
    throw serviceError()
  })
  const startService = mock(async () => {
    throw new Error("start still pending")
  })
  const started = performance.now()
  await expect(
    withMachineServiceRecovery({ action, probe, startService, onWaiting: () => {}, timeoutMs: 320 }),
  ).rejects.toBe(error)
  expect(performance.now() - started).toBeGreaterThanOrEqual(300)
  expect(probe).toHaveBeenCalledTimes(1)
  expect(startService).toHaveBeenCalledTimes(1)
  expect(action).toHaveBeenCalledTimes(1)
  expect(error.code).toBe("TOURI-E8001")
})

test.each(["start", "probe"])("a stalled service %s is bounded and cannot resume boot after timeout", async (stage) => {
  const blocked = deferred()
  const error = serviceError()
  const action = mock(async () => {
    throw error
  })
  let probeSignal: AbortSignal | undefined
  await expect(
    withMachineServiceRecovery({
      action,
      startService: async () => {
        if (stage === "start") await blocked.promise
      },
      probe: async (signal) => {
        probeSignal = signal
        await blocked.promise
      },
      onWaiting: () => {},
      timeoutMs: stage === "probe" ? 320 : 30,
    }),
  ).rejects.toBe(error)
  if (stage === "probe") expect(probeSignal?.aborted).toBe(true)
  blocked.resolve()
  await Bun.sleep(5)
  expect(action).toHaveBeenCalledTimes(1)
})

test.each(["start", "backoff", "probe"])(
  "canceling service %s ends preparation without a late retry",
  async (stage) => {
    const controller = new AbortController()
    const blocked = deferred()
    const entered = deferred()
    const action = mock(async () => {
      throw serviceError()
    })
    const canceled = new Error("turn canceled")
    const result = withMachineServiceRecovery({
      action,
      startService: async () => {
        if (stage !== "probe") entered.resolve()
        if (stage === "start") await blocked.promise
      },
      probe: async () => {
        entered.resolve()
        await blocked.promise
      },
      onWaiting: () => {},
      signal: controller.signal,
    })
    await entered.promise
    controller.abort(canceled)
    await expect(result).rejects.toBe(canceled)
    blocked.resolve()
    await Bun.sleep(5)
    expect(action).toHaveBeenCalledTimes(1)
  },
)

test("the service budget does not cap healthy image and guest preparation", async () => {
  const action = mock(async () => {
    if (action.mock.calls.length === 1) throw serviceError()
    await Bun.sleep(150)
    return "ready"
  })
  expect(
    await withMachineServiceRecovery({
      action,
      probe: async () => {},
      startService: async () => {},
      onWaiting: () => {},
      timeoutMs: 320,
    }),
  ).toBe("ready")
})

test("repeated failures during the same boot share one start and one wait budget", async () => {
  const action = mock(async () => {
    throw serviceError()
  })
  const startService = mock(async () => {})
  const probe = mock(async () => {})
  await expect(
    withMachineServiceRecovery({
      action,
      probe,
      startService,
      onWaiting: () => {},
      timeoutMs: 320,
    }),
  ).rejects.toMatchObject({ code: "TOURI-E8001" })
  expect(action).toHaveBeenCalledTimes(2)
  expect(startService).toHaveBeenCalledTimes(1)
  expect(probe).toHaveBeenCalledTimes(1)
})

test.each([new Error("image unavailable"), new MachineServiceError("MACHINE_SERVICE_START_FAILED", "start failed")])(
  "unrelated boot errors are not retried",
  async (error) => {
    const startService = mock(async () => {})
    await expect(
      withMachineServiceRecovery({
        action: async () => {
          throw error
        },
        probe: async () => {},
        startService,
        onWaiting: () => {},
      }),
    ).rejects.toBe(error)
    expect(startService).not.toHaveBeenCalled()
  },
)
