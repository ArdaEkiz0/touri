import type { Database } from "bun:sqlite"
import type { Kernel } from "@touri/contracts"

export type ProcessOwner = { botId: string; machine: string }
export const processOwner = (kernel: Kernel, processId: string): ProcessOwner | null => {
  const row = (kernel.db as Database)
    .query("SELECT value_json FROM settings WHERE key = ?")
    .get(`process-owner:${processId}`) as { value_json: string } | null
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as ProcessOwner
  } catch {
    return null
  }
}
export const saveProcessOwner = (kernel: Kernel, processId: string, owner: ProcessOwner): void => {
  ;(kernel.db as Database)
    .query(
      "INSERT INTO settings(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
    )
    .run(`process-owner:${processId}`, JSON.stringify(owner), Date.now())
}
