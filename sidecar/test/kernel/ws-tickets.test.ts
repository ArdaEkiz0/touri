import { expect, test } from "bun:test"
import { createSocketTickets } from "../../src/kernel/ws-tickets"

test("S14: tickets are single-use, expire and cannot cross event/desktop/presence endpoints", () => {
  let at = 1000
  const tickets = createSocketTickets({ now: () => at, ttlMs: 100, limit: 2 })
  const paths = [
    "/api/v1/events",
    `/api/v1/desktop/${"a".repeat(48)}/socket`,
    "/api/v1/bots/test-bot/machine/presence/socket",
  ]
  for (const path of paths) {
    const ticket = tickets.mint(path)
    expect(ticket).toBeString()
    expect(tickets.consume(ticket ?? "", path)).toEqual({})
    expect(tickets.consume(ticket ?? "", path)).toBeNull()
    const wrong = tickets.mint(path)
    expect(tickets.consume(wrong ?? "", "/api/v1/other")).toBeNull()
    expect(tickets.consume(wrong ?? "", path)).toBeNull()
    const stale = tickets.mint(path)
    at += 100
    expect(tickets.consume(stale ?? "", path)).toBeNull()
  }
  expect(tickets.mint("//evil.example/api/v1/events")).toBeNull()
  expect(tickets.mint("/api/v1/events?token=anything")).toBeNull()
})

test("S14/A03: tickets fail after device revocation and have a bounded pending store", () => {
  let active = true
  const tickets = createSocketTickets({ limit: 1 })
  const ticket = tickets.mint("/api/v1/events", { deviceId: "test", active: () => active })
  expect(tickets.mint("/api/v1/events")).toBeNull()
  active = false
  expect(tickets.consume(ticket ?? "", "/api/v1/events")).toBeNull()
  expect(tickets.mint("/api/v1/events")).toBeString()
})
