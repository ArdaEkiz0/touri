import type { Kernel } from "@touri/contracts"
import type { WorkEffect } from "./work-state"

export type SurfaceUncertainEffectsArgs = { kernel: Kernel; effects: Array<WorkEffect> }

/** Builds the pt-BR warning shown in the thread for an effect whose outcome is unknown. */
export const uncertainEffectText = (effect: WorkEffect): string => {
  const subject = effect.pid === null ? "chegou a iniciar" : "terminou"
  return `Não foi possível confirmar se o processo ${effect.description} ${subject}; verifique antes de repetir.`
}

/** Posts one warning notice per uncertain effect into the thread that started it. */
export const surfaceUncertainEffects = ({ kernel, effects }: SurfaceUncertainEffectsArgs): number => {
  const store = kernel.services.use("store.api")
  if (!store) return 0
  const delivered = effects.flatMap((effect) => {
    const thread = effect.threadId === null ? null : store.getThread({ threadId: effect.threadId })
    if (!thread) return []
    const part = {
      type: "notice" as const,
      level: "warning" as const,
      code: "run_failed" as const,
      text: uncertainEffectText(effect),
    }
    const result = store.insertMessage({
      message: {
        id: kernel.newId(),
        threadId: thread.id,
        parentId: thread.activeLeafId,
        role: "system",
        kind: "notice",
        status: "complete",
        runId: null,
        text: part.text,
        parts: [part],
        sender: null,
        source: "local",
      },
    })
    if (!result.success) return []
    kernel.publish({ type: "message.created", message: result.message })
    return [result.message.id]
  })
  return delivered.length
}
