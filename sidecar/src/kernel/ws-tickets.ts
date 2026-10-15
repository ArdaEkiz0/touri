import { randomBytes } from "node:crypto"
import type { DeviceSession } from "./device-session"

export const socketEndpoint = (path: string): boolean =>
  path === "/api/v1/events" ||
  /^\/api\/v1\/desktop\/[a-f0-9]{48}\/socket$/.test(path) ||
  /^\/api\/v1\/bots\/[a-zA-Z0-9-]+\/machine\/presence\/socket$/.test(path)

export const createSocketTickets = ({ now = Date.now, ttlMs = 15_000, limit = 1024 } = {}) => {
  const tickets = new Map<string, { path: string; expires: number; session?: DeviceSession }>()
  return {
    mint(path: string, session?: DeviceSession): string | null {
      for (const [key, item] of tickets)
        if (item.expires <= now() || (item.session && !item.session.active())) tickets.delete(key)
      if (!socketEndpoint(path) || tickets.size >= limit || (session && !session.active())) return null
      const ticket = randomBytes(32).toString("base64url")
      tickets.set(ticket, { path, expires: now() + ttlMs, ...(session ? { session } : {}) })
      return ticket
    },
    consume(ticket: string, path: string): { session?: DeviceSession } | null {
      const item = tickets.get(ticket)
      tickets.delete(ticket)
      if (!item || item.path !== path || item.expires <= now() || (item.session && !item.session.active())) return null
      return item.session ? { session: item.session } : {}
    },
  }
}
