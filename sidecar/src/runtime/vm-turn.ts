import type { Kernel, ProviderAdapter, StartTurnArgs } from "@touri/contracts"
import { vmStage } from "../vm/stage"

export const startVmTurn = ({
  kernel,
  provider,
  args,
  firstOutputMs = 90_000,
  turnMs = 30 * 60_000,
}: {
  kernel: Kernel
  provider: ProviderAdapter
  args: StartTurnArgs
  firstOutputMs?: number
  turnMs?: number
}) =>
  vmStage({
    kernel,
    botId: args.bot.id,
    threadId: args.thread.id,
    stage: "turn",
    signal: args.signal,
    timeoutMs: turnMs,
    timeoutMessage: `O turno na máquina excedeu ${turnMs / 60_000} minutos`,
    action: async (signal) => {
      const execution = args.execution
      let output: () => void = () => {}
      const firstOutput = new Promise<void>((resolve) => {
        output = resolve
      })
      let sawOutput = false
      const result = provider.startTurn({
        ...args,
        signal,
        ...(execution
          ? {
              execution: {
                ...execution,
                spawn: (input) => {
                  signal.throwIfAborted()
                  const child = execution.spawn(input)
                  if (child.success) {
                    const cancel = () => child.kill("SIGKILL")
                    signal.addEventListener("abort", cancel, { once: true })
                    void child.exited.finally(() => signal.removeEventListener("abort", cancel)).catch(() => {})
                  }
                  return child
                },
              },
            }
          : {}),
        onEvent: (event) => {
          if (signal.aborted) return
          // Protocol/session acknowledgments are not output from the user's turn.
          if (!sawOutput && event.type !== "session" && event.type !== "turn_started") {
            sawOutput = true
            output()
          }
          args.onEvent(event)
        },
      })
      // Observe failure/rejection too: a CLI that exits before output must finish
      // immediately, rather than wait for the first-output timer.
      await vmStage({
        kernel,
        botId: args.bot.id,
        threadId: args.thread.id,
        stage: "first-output",
        signal,
        timeoutMs: firstOutputMs,
        timeoutMessage: `O ${args.bot.provider === "opencode" ? "OpenCode" : args.bot.provider === "codex" ? "Codex" : "Claude"} na máquina não produziu saída em ${firstOutputMs / 1000} s`,
        action: () => Promise.race([firstOutput, result.then(() => {})]),
      })
      return await result
    },
  })
