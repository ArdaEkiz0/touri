import type { Id } from "@touri/contracts"
import { useCallback, useEffect, useMemo, useState } from "react"
import { readWorkspaceState, saveWorkspaceState } from "./workspaceState"

export type BotLastViewed = {
  /** Last time each bot was on screen; bots never seen before start from when they first appeared. */
  lastViewed: Record<Id, number>
  markViewed: (botId: Id, at: number) => void
}

/** Per-bot "last viewed" timestamps, persisted with the rest of the local workspace state. */
export const useBotLastViewed = (botIds: ReadonlyArray<Id>): BotLastViewed => {
  const [openedAt] = useState(Date.now)
  const [stored, setStored] = useState<Record<Id, number>>(() => readWorkspaceState().lastViewedByBot ?? {})
  const key = botIds.join("\n")
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined key tracks the id list by value
  const lastViewed = useMemo(
    () => Object.fromEntries(botIds.map((id) => [id, stored[id] ?? openedAt])),
    [key, stored, openedAt],
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined key tracks the id list by value
  useEffect(() => {
    if (botIds.every((id) => stored[id] !== undefined)) return
    setStored((current) => {
      const next = { ...Object.fromEntries(botIds.map((id) => [id, openedAt])), ...current }
      saveWorkspaceState({ lastViewedByBot: next })
      return next
    })
  }, [key, stored, openedAt])
  const markViewed = useCallback((botId: Id, at: number): void => {
    setStored((current) => {
      if ((current[botId] ?? 0) >= at) return current
      const next = { ...current, [botId]: at }
      saveWorkspaceState({ lastViewedByBot: next })
      return next
    })
  }, [])
  return { lastViewed, markViewed }
}
