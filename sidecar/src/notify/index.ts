import type { Database } from "bun:sqlite"
import type { Kernel, NotifyKind } from "@touri/contracts"
import { createNotifier } from "./notifier"
import { createNotifyRoutes } from "./routes"
import { createSseHub } from "./sse"
import { createNotificationStore } from "./store"

export const name = "notify"

const RESOLVED_BY_USER_REPLY: ReadonlyArray<NotifyKind> = ["question", "turn-failed", "routine-failed"]

export const init = async (kernel: Kernel): Promise<void> => {
  const store = createNotificationStore({ db: kernel.db as Database })
  const hub = createSseHub({ store })
  const notifier = createNotifier({ kernel, store, hub })

  kernel.services.provide("notify.emit", notifier.emit)
  kernel.services.provide("notify.resolve", ({ requestId, resolution }) => {
    notifier.resolveRequest({ requestId, resolution })
  })

  kernel.subscribe(({ event }) => {
    if (event.type !== "message.created" || event.message.role !== "user") return
    for (const item of store.unresolvedForThread({ threadId: event.message.threadId, kinds: RESOLVED_BY_USER_REPLY }))
      notifier.finish({ id: item.id, resolution: "replied" })
  })

  kernel.registerRoutes(createNotifyRoutes({ kernel, store, notifier, hub }))
}
