import type { DoctorCheck } from "@touri/contracts"
import { containerMemoryMb, containerName, containerState, inventoryEntries, isBotContainer } from "./inventory"

export const containerMemoryChecks = (output: {
  code: number | null
  stdout: string
  timedOut?: boolean
}): Array<DoctorCheck> => {
  try {
    if (output.code !== 0 || output.timedOut) throw new Error("Inventário indisponível")
    const entries = inventoryEntries(output.stdout)
    const checks: Array<DoctorCheck> = []
    const nonBots: Array<string> = []
    for (const entry of entries) {
      const name = containerName(entry)
      const state = containerState(entry)
      const memoryMb = containerMemoryMb(entry)
      checks.push({
        id: `vm-memory:${name}`,
        label: `Memória · ${name}`,
        ok: memoryMb !== null,
        status: memoryMb !== null ? "pass" : "warn",
        detail: `${name}: ${state}; limite configurado ${memoryMb !== null ? `${memoryMb.toFixed(0)} MiB` : "indisponível"} (não mede RAM residente)`,
        fix: null,
      })
      if (state === "running" && name.startsWith("touri-") && !isBotContainer(name)) nonBots.push(name)
    }
    checks.push({
      id: "vm-orphans",
      label: "Máquinas · helpers em execução",
      ok: nonBots.length === 0,
      status: nonBots.length ? "warn" : "pass",
      detail: nonBots.length
        ? `Containers touri fora dos bots em execução: ${nonBots.join(", ")}`
        : "Nenhum container touri fora dos bots em execução",
      fix: null,
    })
    const builderRunning = entries.some(
      (entry) => containerName(entry) === "buildkit" && containerState(entry) === "running",
    )
    checks.push({
      id: "vm-builder",
      label: "Máquinas · builder",
      ok: !builderRunning,
      status: builderRunning ? "warn" : "pass",
      detail: builderRunning ? "Builder buildkit em execução; ocupa uma VM no host" : "Builder parado",
      fix: builderRunning ? "container builder stop" : null,
    })
    return checks
  } catch {
    return [
      {
        id: "vm-inventory",
        label: "Máquinas · memória por VM",
        ok: false,
        status: "warn",
        detail:
          "Não foi possível ler a memória das VMs. Verifique o serviço container e execute o diagnóstico novamente.",
        fix: "container list --all --format json",
      },
    ]
  }
}
