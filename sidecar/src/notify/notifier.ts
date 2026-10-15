import type { Database } from "bun:sqlite"
import type { Kernel, NotificationRecord, NotifyInput, NotifyResolution } from "@touri/contracts"
import { buildDeepLink, shouldNotifyNative } from "./native"
import type { SseHub } from "./sse"
import type { NotificationStore } from "./store"

const MAX_TITLE = 200
const MAX_BODY = 2000

const clip = ({ value, max }: { value: string; max: number }): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

const nativeEnabled = (kernel: Kernel): boolean => {
  const row = (kernel.db as Database)
    .query("SELECT value_json FROM settings WHERE key = 'nativeNotifications'")
    .get() as {
    value_json: string
  } | null
  return row === null || row.value_json !== "false"
}

export const createNotifier = ({ kernel, store, hub }: { kernel: Kernel; store: NotificationStore; hub: SseHub }) => {
  const sendNative = (notification: NotificationRecord): void => {
    if (!nativeEnabled(kernel)) return
    const bot = notification.botId
      ? (kernel.services.use("store.api")?.getBot({ botId: notification.botId }) ?? null)
      : null
    if (!shouldNotifyNative({ notification, preference: bot?.notifications ?? null })) return
    void kernel.callHost("notify", {
      title: notification.botName ? `${notification.botName}: ${notification.title}` : notification.title,
      body: notification.body,
      threadId: notification.threadId,
      onlyWhenUnfocused: true,
      deepLink: buildDeepLink({ botId: notification.botId, threadId: notification.threadId }),
    })
  }

  const emit = (input: NotifyInput): NotificationRecord => {
    const { notification, seq } = store.insert({
      ...input,
      threadId: input.threadId
        ? (kernel.services.use("store.api")?.getThread({ threadId: input.threadId })?.groupThreadId ?? input.threadId)
        : null,
      title: clip({ value: kernel.redact(input.title), max: MAX_TITLE }),
      body: clip({ value: kernel.redact(input.body), max: MAX_BODY }),
    })
    kernel.publish({ type: "notification.created", notification })
    hub.broadcast({ seq, type: "notify", notification })
    sendNative(notification)
    return notification
  }

  const finish = ({ id, resolution }: { id: number; resolution: NotifyResolution }): NotificationRecord | null => {
    const resolved = store.resolve({ id, resolution })
    if (!resolved) return null
    kernel.publish({ type: "notification.resolved", notification: resolved.notification })
    hub.broadcast({ seq: resolved.seq, type: "resolved", notification: resolved.notification })
    return resolved.notification
  }

  const resolveRequest = ({
    requestId,
    resolution,
  }: {
    requestId: string
    resolution: NotifyResolution
  }): NotificationRecord | null => {
    const found = store.byRequestId(requestId)
    return found ? finish({ id: found.id, resolution }) : null
  }

  return { emit, finish, resolveRequest }
}

export type Notifier = ReturnType<typeof createNotifier>
