import { describe, expect, it, vi } from "vitest"

const compile = vi.fn(() => () => true)
vi.mock("ajv", () => ({ default: vi.fn(() => ({ compile })) }))

describe("@touri/contracts under the desktop CSP", () => {
  it("does not compile schemas (new Function) on import", async () => {
    await import("@touri/contracts")
    await import("@touri/contracts/errors")
    expect(compile).not.toHaveBeenCalled()
  })

  it("compiles validators on first use", async () => {
    const { validateToolArgs } = await import("@touri/contracts")
    validateToolArgs({ name: "nonexistent.tool", args: {} })
    expect(compile).toHaveBeenCalled()
  })
})
