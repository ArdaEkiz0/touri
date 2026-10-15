export const DEFAULT_BOT_VM_MEMORY_MB = 1536
export const DEFAULT_MACHINE_IDLE_MINUTES = 10
export const validBotVmMemory = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 512 && value <= 16384
