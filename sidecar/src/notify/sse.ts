import type { NotificationRecord, NotifySseEvent } from "@touri/contracts"
import { deviceSession } from "../kernel/device-session"
import { HEARTBEAT_MS } from "./kinds"
import type { LogEntry, NotificationStore } from "./store"

const encoder = new TextEncoder()

export const formatFrame = ({
  seq,
  event,
  data,
}: {
  seq: number | null
  event: NotifySseEvent
  data: unknown
}): string => `${seq === null ? "" : `id: ${seq}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const notifyPayload = (notification: NotificationRecord): Record<string, unknown> => ({
  type: "notify",
  ...notification,
})

export const resolvedPayload = (notification: NotificationRecord): Record<string, unknown> => ({
  type: "resolved",
  id: notification.id,
  requestId: notification.requestId,
  resolution: notification.resolution,
  resolvedAt: notification.resolvedAt,
})

const frameFor = (entry: LogEntry): string =>
  formatFrame({
    seq: entry.seq,
    event: entry.type,
    data: entry.type === "notify" ? notifyPayload(entry.notification) : resolvedPayload(entry.notification),
  })

export const parseSince = ({ query, header }: { query: string | undefined; header: string | null }): number | null => {
  const raw = query ?? header
  if (raw === undefined || raw === null || raw === "") return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

type Listener = (entry: LogEntry) => void

export const createSseHub = ({
  store,
  heartbeatMs = HEARTBEAT_MS,
}: {
  store: NotificationStore
  heartbeatMs?: number
}) => {
  const listeners = new Set<Listener>()

  const broadcast = (entry: LogEntry): void => {
    for (const listener of listeners) listener(entry)
  }

  const backlog = (since: number | null): { frames: Array<string>; lastSeq: number } => {
    const lastSeq = store.lastSeq()
    if (since !== null && since <= lastSeq) {
      const entries = store.logSince({ since })
      return { frames: entries.map(frameFor), lastSeq }
    }
    const frames = store
      .pending()
      .map((notification) => formatFrame({ seq: null, event: "notify", data: notifyPayload(notification) }))
    return { frames, lastSeq }
  }

  const open = ({ since, signal }: { since: number | null; signal: AbortSignal }): ReadableStream<Uint8Array> => {
    const device = deviceSession(signal)
    const state: {
      listener: Listener | null
      timer: ReturnType<typeof setInterval> | null
      controller: ReadableStreamDefaultController<Uint8Array> | null
    } = {
      listener: null,
      timer: null,
      controller: null,
    }
    const close = (): void => {
      if (state.listener) listeners.delete(state.listener)
      if (state.timer) clearInterval(state.timer)
      state.listener = null
      state.timer = null
      signal.removeEventListener("abort", close)
      try {
        state.controller?.close()
      } catch {
        // Cancellation has already closed the stream.
      }
      state.controller = null
    }
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        state.controller = controller
        if (signal.aborted || (device && !device.active())) {
          close()
          return
        }
        const write = (text: string): void => {
          if (device && !device.active()) {
            close()
            return
          }
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            close()
          }
        }
        write("retry: 3000\n\n")
        const initial = backlog(since)
        for (const frame of initial.frames) write(frame)
        write(`id: ${initial.lastSeq}\nevent: ready\ndata: ${JSON.stringify({ lastSeq: initial.lastSeq })}\n\n`)
        state.listener = (entry) => write(frameFor(entry))
        listeners.add(state.listener)
        state.timer = setInterval(() => write(": ping\n\n"), heartbeatMs)
        signal.addEventListener("abort", close, { once: true })
      },
      cancel: close,
    })
  }

  return { open, broadcast, size: (): number => listeners.size }
}

export type SseHub = ReturnType<typeof createSseHub>
