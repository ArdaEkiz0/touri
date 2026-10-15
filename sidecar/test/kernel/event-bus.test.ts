import { expect, test } from "bun:test"
import { createEventBus } from "../../src/kernel/event-bus"

test("r2: closing or stale websocket cannot interrupt broadcasts or sidecar requests", () => {
  const bus = createEventBus()
  let deadCalls = 0
  const healthy: Array<string> = []
  bus.add({
    readyState: 1,
    sendText: () => {
      deadCalls++
      throw new Error("socket closed during reload")
    },
  })
  bus.add({
    readyState: 3,
    sendText: () => {
      throw new Error("must not send on closed socket")
    },
  })
  bus.add({
    readyState: 1,
    sendText: (payload: string) => {
      healthy.push(payload)
      return payload.length
    },
  })
  for (let index = 0; index < 2; index++)
    expect(() =>
      bus.publish({ type: "import.progress", importId: "r2", phase: "done", done: 1, total: 1 }),
    ).not.toThrow()
  expect(deadCalls).toBe(1)
  expect(healthy).toHaveLength(2)
})
