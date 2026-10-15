import type { Database } from "bun:sqlite"
import { isIP } from "node:net"
import { networkInterfaces } from "node:os"
import type { Kernel } from "@touri/contracts"
import { BOT_DNS } from "./image"
import type { VmProvider } from "./types"

export type EgressPolicy = { allowLan: boolean; resolvers: string[]; privateDomains: string[] }
export const defaultEgressPolicy = (): EgressPolicy => ({
  allowLan: false,
  resolvers: [...BOT_DNS],
  privateDomains: [],
})
export const policyKey = (botId: string, active = false) => `vm-network:${active ? "active:" : ""}${botId}`
export const readEgressPolicy = (kernel: Kernel, botId: string, active = false): EgressPolicy => {
  const row = (kernel.db as Database)
    .query("SELECT value_json FROM settings WHERE key = ?")
    .get(policyKey(botId, active)) as { value_json: string } | null
  return row ? validateEgressPolicy(JSON.parse(row.value_json)) : defaultEgressPolicy()
}
export const validateEgressPolicy = (value: unknown): EgressPolicy => {
  const p = value as Partial<EgressPolicy> | null
  if (
    !p ||
    typeof p.allowLan !== "boolean" ||
    !Array.isArray(p.resolvers) ||
    p.resolvers.length > 4 ||
    p.resolvers.some((ip) => typeof ip !== "string" || !isIP(ip)) ||
    !Array.isArray(p.privateDomains) ||
    p.privateDomains.length > 64 ||
    p.privateDomains.some((domain) => typeof domain !== "string" || !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(domain))
  )
    throw new Error("Política de rede inválida")
  return {
    allowLan: p.allowLan,
    resolvers: [...new Set(p.resolvers)],
    privateDomains: [...new Set(p.privateDomains.map((domain) => domain.toLowerCase()))],
  }
}
export const saveEgressPolicy = (kernel: Kernel, botId: string, policy: EgressPolicy, active = false) => {
  ;(kernel.db as Database)
    .query(
      "INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at",
    )
    .run(policyKey(botId, active), JSON.stringify(policy), Date.now())
}
export const tightenEgressPolicy = (active: EgressPolicy, requested: EgressPolicy): EgressPolicy => ({
  allowLan: active.allowLan && requested.allowLan,
  resolvers: active.resolvers.filter((ip) => requested.resolvers.includes(ip)),
  privateDomains: [...new Set([...active.privateDomains, ...requested.privateDomains])],
})
export const installEgressPolicy = async (
  provider: VmProvider,
  id: string,
  policy: EgressPolicy,
  signal?: AbortSignal,
) => {
  try {
    const result = await provider.exec({
      id,
      user: "0",
      command: "python3",
      args: [
        "/usr/local/lib/touri/network-policy.py",
        "apply",
        JSON.stringify({
          ...policy,
          hostAddresses: Object.values(networkInterfaces()).flatMap((interfaces) =>
            (interfaces ?? []).map((item) => item.address.split("%")[0]),
          ),
        }),
      ],
      ...(signal ? { signal } : {}),
    })
    if (!result.success || result.code !== 0) throw new Error("policy install failed")
  } catch {
    await provider.stop({ id })
    throw new Error("Não foi possível aplicar a proteção de rede. A máquina foi parada.")
  }
}
