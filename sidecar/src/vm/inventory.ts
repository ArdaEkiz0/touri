export type ContainerEntry = Record<string, unknown>

export const asRecord = (value: unknown): ContainerEntry | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ContainerEntry) : null

export const inventoryEntries = (json: string): Array<ContainerEntry> => {
  const value: unknown = JSON.parse(json)
  const root = asRecord(value)
  const entries = Array.isArray(value) ? value : (root?.containers ?? root?.volumes ?? root?.items ?? root?.data)
  if (!Array.isArray(entries) || entries.some((entry) => !asRecord(entry)))
    throw new Error("Inventário container inválido")
  return entries as Array<ContainerEntry>
}

export const containerName = (entry: ContainerEntry): string => {
  const config = asRecord(entry.configuration)
  const value = config?.id ?? config?.name ?? entry.name ?? entry.id ?? entry.identifier
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(value))
    throw new Error("Nome container inválido")
  return value
}

export const isHelperContainer = (name: string): boolean =>
  /^touri-(migrate|upgrade-test)-[a-z0-9][a-z0-9_.-]*$/.test(name)
export const isHelperVolume = (name: string): boolean => name.endsWith("-data") && isHelperContainer(name.slice(0, -5))
export const isBotContainer = (name: string): boolean => /^touri-[a-f0-9]{10}-[a-f0-9]{20}$/.test(name)

export const containerState = (entry: ContainerEntry): string => {
  const value = entry.status ?? entry.state
  const nested = asRecord(value)
  const state = typeof value === "string" ? value : (nested?.state ?? nested?.status)
  return typeof state === "string" ? state.toLowerCase() : "unknown"
}

// An absent mount inventory is never evidence that a volume is unused.
export const mountedVolumes = (entry: ContainerEntry): Array<string> => {
  const mounts = asRecord(entry.configuration)?.mounts
  if (!Array.isArray(mounts)) throw new Error("Mounts ausentes no inventário container")
  return mounts.flatMap((value) => {
    const mount = asRecord(value)
    const type = asRecord(mount?.type)
    const volume = asRecord(type?.volume)
    if (volume && typeof volume.name === "string") return [volume.name]
    if (type && (asRecord(type.virtiofs) || asRecord(type.tmpfs))) return []
    throw new Error("Mount desconhecido no inventário container")
  })
}

export const containerMemoryMb = (entry: ContainerEntry): number | null => {
  const bytes = asRecord(asRecord(entry.configuration)?.resources)?.memoryInBytes
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 ** 2 : null
}
