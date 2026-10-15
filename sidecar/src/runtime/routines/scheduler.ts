import type { HostNotification, Kernel } from "@touri/contracts"
import type { createRuntimeEngine } from "../engine"

type Engine = ReturnType<typeof createRuntimeEngine>

export const createRoutineScheduler = ({
  kernel,
  engine,
  intervalMs = 30_000,
}: {
  kernel: Kernel
  engine: Engine
  intervalMs?: number
}): { stop: () => void; tick: (now?: number) => Promise<void> } => {
  const timer = setInterval(() => void engine.tick(), intervalMs)
  const timerWithUnref = timer as unknown as { unref?: () => void }
  timerWithUnref.unref?.()
  const onHostNotification = (notification: HostNotification): void => {
    if (notification.method === "power.sleep" && notification.params.sleeping === false) void engine.tick()
  }
  const unsubscribe = kernel.onHostNotification(onHostNotification)
  void engine.tick()
  return {
    stop: () => {
      clearInterval(timer)
      unsubscribe()
    },
    tick: engine.tick,
  }
}
