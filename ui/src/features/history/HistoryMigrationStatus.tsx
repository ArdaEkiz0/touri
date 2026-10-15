import type { ApiRoutes } from "@touri/contracts"
import { useEffect, useState } from "react"
import type { UiApi } from "../../api/client"
import "./history.css"

type Progress = NonNullable<ApiRoutes["GET /health"]["res"]["historyMigration"]>

export const HistoryMigrationStatus = ({ api }: { api: UiApi }) => {
  const [progress, setProgress] = useState<Progress | null>(null)
  useEffect(() => {
    let active = true
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async (): Promise<void> => {
      const attempt = ++generation
      clearTimeout(timer)
      try {
        const health = await api.request("GET /health", {})
        if (!active || attempt !== generation) return
        const next = health.historyMigration ?? null
        setProgress(next)
        if (!next?.running) return
      } catch {
        if (!active || attempt !== generation) return
      }
      timer = setTimeout(() => void read(), 1000)
    }
    setProgress(null)
    void read()
    return () => {
      active = false
      generation += 1
      clearTimeout(timer)
    }
  }, [api])

  if (!progress?.running) return null
  const percent = Math.min(100, Math.max(0, Math.floor((progress.done / Math.max(1, progress.total)) * 100)))
  return (
    <div className="history-migration-status" role="status" aria-live="polite">
      Migrando histórico… {percent}%
    </div>
  )
}
