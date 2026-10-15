import type { VmCommandRunner } from "./command"
import { containerName, inventoryEntries, isHelperContainer, isHelperVolume, mountedVolumes } from "./inventory"

export type VmWarning = (code: string, detail: string) => void
export const defaultVmWarning: VmWarning = (code, detail) => console.warn(`[${code}] ${detail}`)

export const createContainerMaintenance = ({
  run,
  warn = defaultVmWarning,
  timeoutMs = 10_000,
}: {
  run: VmCommandRunner
  warn?: VmWarning
  timeoutMs?: number
}) => {
  let migrations = 0
  let sweeping: Promise<void> | null = null
  const retainedVolumes = new Set<string>()
  const bounded = async (args: Array<string>) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error("Tempo limite de limpeza da VM")), timeoutMs)
    try {
      return await Promise.race([
        run(args, { signal: controller.signal }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
        ),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const destroyHelper = async (id: string): Promise<boolean> => {
    if (!isHelperContainer(id)) throw new Error("Limpeza restrita a helpers")
    let failure = ""
    for (let attempt = 0; attempt < 2; attempt++) {
      // A stuck stop must not prevent force deletion; cleanup ignores migration cancellation.
      await bounded(["stop", "--time", "5", id]).catch(() => undefined)
      try {
        const deleted = await bounded(["delete", "--force", id])
        if (deleted.code === 0 || /notFound|not found|does not exist/i.test(deleted.stderr)) return true
        failure = deleted.stderr
      } catch (error) {
        failure = String(error)
      }
    }
    warn("VM_HELPER_CLEANUP_FAILED", `${id}: ${failure}`)
    return false
  }
  const sweepOrphans = (protectedVolumes: Array<string> = []): Promise<void> => {
    if (migrations) return Promise.resolve()
    if (sweeping) return sweeping
    sweeping = (async () => {
      const listed = await bounded(["list", "--all", "--format", "json"])
      if (listed.code !== 0) throw new Error(listed.stderr)
      const entries = inventoryEntries(listed.stdout)
      const helpers = entries.filter((entry) => isHelperContainer(containerName(entry)))
      const protectedNames = new Set([...protectedVolumes, ...retainedVolumes])
      for (const entry of entries) {
        if (isHelperContainer(containerName(entry))) continue
        // Older list output may omit configuration; inspect before deleting any data.
        let inspected = entry
        if (!Array.isArray((entry.configuration as { mounts?: unknown } | undefined)?.mounts)) {
          const result = await bounded(["inspect", containerName(entry)])
          if (result.code !== 0) throw new Error(result.stderr)
          const found = inventoryEntries(result.stdout).find((item) => containerName(item) === containerName(entry))
          if (!found) throw new Error("Container ausente no inspect")
          inspected = found
        }
        for (const name of mountedVolumes(inspected)) protectedNames.add(name)
      }
      const volumes = await bounded(["volume", "list", "--format", "json"])
      if (volumes.code !== 0) throw new Error(volumes.stderr)
      const names = inventoryEntries(volumes.stdout).map(containerName).filter(isHelperVolume)
      for (const helper of helpers) {
        const id = containerName(helper)
        if (!(await destroyHelper(id))) protectedNames.add(`${id}-data`)
      }
      for (const name of names) {
        if (protectedNames.has(name)) continue
        const deleted = await bounded(["volume", "delete", name])
        if (deleted.code !== 0) warn("VM_HELPER_VOLUME_CLEANUP_FAILED", `${name}: ${deleted.stderr}`)
      }
    })()
      .catch((error) => warn("VM_ORPHAN_SWEEP_FAILED", String(error)))
      .finally(() => {
        sweeping = null
      })
    return sweeping
  }
  return {
    destroyHelper,
    sweepOrphans,
    stopBuilder: async () => {
      try {
        const result = await bounded(["builder", "stop"])
        if (result.code !== 0) warn("VM_BUILDER_STOP_FAILED", result.stderr)
      } catch (error) {
        warn("VM_BUILDER_STOP_FAILED", String(error))
      }
    },
    retainVolume: (name: string) => retainedVolumes.add(name),
    withMigration: async <T>(action: () => Promise<T>): Promise<T> => {
      migrations++
      try {
        // A migration starting during inventory waits for that sweep to finish.
        await sweeping
        return await action()
      } finally {
        migrations--
      }
    },
  }
}
