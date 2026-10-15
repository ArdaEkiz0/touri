import { getCurrentWindow } from "@tauri-apps/api/window"
import type { Bot, MachineIntent } from "@touri/contracts"
import { useCallback, useEffect, useRef } from "react"
import type { UiApi } from "./api/client"

export const useComposerMachineIntent = (api: UiApi, bot: Bot | null) => {
  const wakes = useRef(new Map<string, { at: number; pending: boolean }>())
  return useCallback(
    (intent: "composer-focus" | "composer-typing") => {
      if (bot?.machine !== "vm" || bot.paused || document.visibilityState === "hidden") return
      const at = Date.now()
      const previous = wakes.current.get(bot.id)
      if (previous?.pending || (previous && at - previous.at < 5000)) return
      const wake = { at, pending: true }
      wakes.current.set(bot.id, wake)
      void api
        .request("POST /bots/:id/machine/intent", { intent }, { id: bot.id })
        .catch(() => {
          wake.at = -Infinity
        })
        .finally(() => {
          wake.pending = false
        })
    },
    [api, bot],
  )
}

// Runs at workspace scope, including when the conversation panel is closed.
export const useMachineParking = (api: UiApi, bots: Array<Bot>, enabled: boolean) => {
  const currentBots = useRef(bots)
  currentBots.current = bots
  useEffect(() => {
    if (!enabled) return
    let lastActivity = Date.now()
    let disposed = false
    let unlisten: (() => void) | undefined
    let nativeFocused = true
    const parked = new Map<string, MachineIntent>()
    const send = (intent: MachineIntent, bot: Bot) => {
      if (parked.get(bot.id) === intent) return
      parked.set(bot.id, intent)
      void api.request("POST /bots/:id/machine/intent", { intent }, { id: bot.id }).catch(() => {
        if (parked.get(bot.id) === intent) parked.delete(bot.id)
      })
    }
    const activity = () => {
      if (!nativeFocused || document.visibilityState === "hidden") return
      lastActivity = Date.now()
      for (const bot of currentBots.current) {
        if (!parked.has(bot.id)) continue
        void api
          .request("POST /bots/:id/machine/intent", { intent: "foreground" }, { id: bot.id })
          .catch(() => undefined)
      }
      parked.clear()
    }
    const blur = () => {
      nativeFocused = false
    }
    const focus = () => {
      nativeFocused = true
      activity()
    }
    const visibility = () => {
      if (document.visibilityState !== "hidden") activity()
    }
    const timer = setInterval(() => {
      // The host is authoritative about activity in turns, terminals and viewers.
      // Focus loss is not idleness; request a check only after the configured delay.
      for (const bot of currentBots.current)
        if (bot.machine === "vm" && Date.now() - lastActivity >= bot.machineIdleMinutes * 60_000) send("idle", bot)
    }, 30_000)
    for (const event of ["pointerdown", "keydown", "input"]) window.addEventListener(event, activity, true)
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener("blur", blur)
    window.addEventListener("focus", focus)
    if ("__TAURI_INTERNALS__" in window)
      void Promise.resolve()
        .then(() =>
          getCurrentWindow().onFocusChanged(({ payload }) => {
            if (disposed) return
            nativeFocused = payload
            if (payload) activity()
          }),
        )
        .then((cleanup) => {
          if (disposed) cleanup()
          else unlisten = cleanup
        })
        .catch(() => {})
    visibility()
    return () => {
      disposed = true
      unlisten?.()
      clearInterval(timer)
      for (const event of ["pointerdown", "keydown", "input"]) window.removeEventListener(event, activity, true)
      document.removeEventListener("visibilitychange", visibility)
      window.removeEventListener("blur", blur)
      window.removeEventListener("focus", focus)
    }
  }, [api, enabled])
}

/** Each tab/window owns its presence; losing focus or pausing RFB does not release it. */
export const useComputerPresence = (api: UiApi, bot: Bot) => {
  useEffect(() => {
    if (bot.machine !== "vm") return
    const viewerId = crypto.randomUUID()
    let active = true
    let socket: WebSocket | null = null
    let reconnect: ReturnType<typeof setTimeout> | undefined
    const connect = async () => {
      if (!active || api.isMock || !api.websocketUrl) return
      const retry = () => {
        if (active && !reconnect)
          reconnect = setTimeout(() => {
            reconnect = undefined
            connect()
          }, 1000)
      }
      try {
        const url = await api.websocketUrl(`/api/v1/bots/${encodeURIComponent(bot.id)}/machine/presence/socket`)
        if (!active) return
        const next = new WebSocket(url)
        socket = next
        next.addEventListener("close", retry)
        next.addEventListener("error", () => next.close())
      } catch {
        retry()
      }
    }
    const send = (intent: "computer-visible" | "computer-hidden") =>
      api.request("POST /bots/:id/machine/intent", { intent, viewerId }, { id: bot.id }).catch(() => undefined)
    const renew = () => {
      void send("computer-visible").then(() => {
        // Also release a renewal that completed after unmount.
        if (!active) void send("computer-hidden")
      })
    }
    renew()
    connect()
    const timer = setInterval(renew, 20_000)
    window.addEventListener("focus", renew)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(reconnect)
      socket?.close()
      window.removeEventListener("focus", renew)
      void send("computer-hidden")
    }
  }, [api, bot.id, bot.machine])
}
