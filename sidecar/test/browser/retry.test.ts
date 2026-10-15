import { expect, test } from "bun:test"
import { withOneTransientRetry } from "../../src/browser/retry"
import "./test-helper"

test("transient browser CDP failures retry exactly once", async () => {
  let attempts = 0
  const recovered = await withOneTransientRetry({
    operation: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("Execution context was destroyed")
      return "ok"
    },
    isTransient: (error) => error instanceof Error && error.message.includes("Execution context was destroyed"),
  })
  expect(recovered).toBe("ok")
  expect(attempts).toBe(2)

  attempts = 0
  await expect(
    withOneTransientRetry({
      operation: async () => {
        attempts += 1
        throw new Error("Execution context was destroyed")
      },
      isTransient: (error) => error instanceof Error && error.message.includes("Execution context was destroyed"),
    }),
  ).rejects.toThrow("Execution context was destroyed")
  expect(attempts).toBe(2)
})
