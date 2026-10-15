import { expect, test } from "bun:test"
import { safeRunFailure } from "@touri/contracts/run-failure"

test.each([
  ["A máquina não ficou pronta em 90 s: Xvfb não iniciou ou o guest não respondeu", "machine_boot"],
  ["A conexão selada da máquina não ficou pronta a tempo", "sealed_connection"],
  ["O Codex na máquina não produziu saída em 90 s", "provider_output"],
  ["O login na máquina não ficou pronto em 15 s", "provider_login"],
] as const)("sanitizes the public timeout cause: %s", (cause, stage) => {
  const failure = safeRunFailure(
    "timeout",
    `${cause}\nstderr /home/alice/.secrets /Users/alice/token $HOME/key ~/key token=secret sk-private Bearer abc123`,
  )
  expect(failure.stage).toBe(stage)
  expect(failure.detail).not.toMatch(/stderr|alice|HOME|private|secret|Bearer|abc123/)
  expect(safeRunFailure("timeout", failure.detail)).toEqual(failure)
})

test("unknown diagnostics never reach the public failure", () => {
  expect(safeRunFailure("timeout", "stderr /home/alice/key token=secret")).toEqual({
    stage: "turn",
    detail: "A operação demorou demais. Tente novamente.",
  })
})
