export type AppRoute =
  | { section: "bots"; screen: "chat" | "preview" }
  | { section: "touri"; page: "cron" | "integracoes" | "mcp" }
type SavedWorkspace = {
  botId?: string | null
  threadId?: string | null
  threadsByBot?: Record<string, string>
  panelsByBot?: Record<string, boolean>
  /** Epoch ms when each bot's conversation was last on screen; drives the sidebar "novidades" state. */
  lastViewedByBot?: Record<string, number>
  route?: AppRoute
}
const KEY = "touri.workspace.v1"

export const readWorkspaceState = (): SavedWorkspace => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    if (!raw || typeof raw !== "object") return {}
    const value = raw as Record<string, unknown>
    const route = value.route as Record<string, unknown> | undefined
    return {
      ...(value.panelsByBot && typeof value.panelsByBot === "object" && !Array.isArray(value.panelsByBot)
        ? {
            panelsByBot: Object.fromEntries(
              Object.entries(value.panelsByBot).filter(([, open]) => typeof open === "boolean"),
            ),
          }
        : {}),
      ...(value.lastViewedByBot && typeof value.lastViewedByBot === "object" && !Array.isArray(value.lastViewedByBot)
        ? {
            lastViewedByBot: Object.fromEntries(
              Object.entries(value.lastViewedByBot).filter(([, at]) => typeof at === "number" && Number.isFinite(at)),
            ),
          }
        : {}),
      ...(typeof value.botId === "string" ? { botId: value.botId } : {}),
      ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
      ...(value.threadsByBot && typeof value.threadsByBot === "object" && !Array.isArray(value.threadsByBot)
        ? {
            threadsByBot: Object.fromEntries(
              Object.entries(value.threadsByBot).filter(([, id]) => typeof id === "string"),
            ),
          }
        : {}),
      ...(route &&
      ((route.section === "bots" && ["chat", "preview"].includes(String(route.screen))) ||
        (route.section === "touri" && ["cron", "integracoes", "mcp"].includes(String(route.page))))
        ? { route: route as AppRoute }
        : {}),
    }
  } catch {
    return {}
  }
}

export const saveWorkspaceState = (patch: SavedWorkspace): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readWorkspaceState(), ...patch }))
  } catch {
    /* Storage may be unavailable in an embedded browser. */
  }
}
