import { expect, test } from "vitest"
import { DISPLAY_STALE_MS, DisplayLiveness, isEmptyDisplay } from "../src/features/desktop/liveness"

const black = (): ImageData => {
  const data = new Uint8ClampedArray(8 * 8 * 4)
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255
  return { data, width: 8, height: 8, colorSpace: "srgb" }
}
const pulse = (sequence: number): ImageData => {
  const image = black()
  image.data.set([sequence, 0x30, 0x40, 255], (4 * 8 + 4) * 4)
  return image
}

test("empty display ignores only the X11 pulse and never treats a transparent buffer as empty", () => {
  expect(isEmptyDisplay(black())).toBe(true)
  expect(isEmptyDisplay(pulse(12))).toBe(true)
  const emptyBuffer = black()
  emptyBuffer.data.fill(0)
  expect(isEmptyDisplay(emptyBuffer)).toBe(false)
  const window = black()
  window.data[0] = 200
  expect(isEmptyDisplay(window)).toBe(false)
  // Pulse-colored pixels outside the actual corner window still count as content.
  const large = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4), colorSpace: "srgb" } as ImageData
  large.data.set([12, 0x30, 0x40, 255], 0)
  expect(isEmptyDisplay(large)).toBe(false)
})

test("an opaque black guest frame is ready without a heartbeat marker", () => {
  const live = new DisplayLiveness(0)
  expect(live.image(black(), 1)).toBe(true)
})

test("a transparent noVNC buffer is not a painted frame and startup still times out", () => {
  const live = new DisplayLiveness(0)
  const image = black()
  image.data.fill(0)
  expect(live.image(image, 1)).toBe(false)
  expect(live.alive(DISPLAY_STALE_MS - 1)).toBe(true)
  expect(live.alive(DISPLAY_STALE_MS)).toBe(false)
})

test("a motionless desktop without input stays healthy for 30 seconds", () => {
  const live = new DisplayLiveness(0)
  for (let at = 0; at <= 30_000; at += 1_000) {
    expect(live.image(black(), at)).toBe(true)
    expect(live.alive(at)).toBe(true)
  }
})

test("input with no subsequent draw trips, and repeated input cannot postpone the deadline", () => {
  const live = new DisplayLiveness(0)
  live.image(black(), 0)
  live.input(30_000)
  live.input(35_000)
  live.image(black(), 37_999)
  expect(live.alive(37_999)).toBe(true)
  expect(live.alive(38_000)).toBe(false)
})

test("a draw after input clears the deadline, including a change away from the corner", () => {
  const live = new DisplayLiveness(0)
  live.image(black(), 0)
  live.input(1)
  const changed = black()
  changed.data[12] = 100
  live.image(changed, 2)
  live.image(changed, 30_000)
  expect(live.alive(30_000)).toBe(true)
  live.input(30_001)
  live.image(changed, 38_001)
  expect(live.alive(38_001)).toBe(false)
})

test("an observed heartbeat must keep advancing even when nobody supplies input", () => {
  const live = new DisplayLiveness(0)
  live.image(pulse(1), 0)
  live.image(pulse(2), 1_000)
  live.image(pulse(2), 8_999)
  expect(live.alive(8_999)).toBe(true)
  live.image(pulse(2), 9_000)
  expect(live.alive(9_000)).toBe(false)
  live.image(pulse(3), 9_001)
  expect(live.alive(9_001)).toBe(true)
})

test("losing an observed heartbeat cannot silently disable its tripwire", () => {
  const live = new DisplayLiveness(0)
  live.image(pulse(1), 0)
  live.image(black(), DISPLAY_STALE_MS)
  expect(live.alive(DISPLAY_STALE_MS)).toBe(false)
})

test("a fresh pulse proves drawing after input even on an otherwise unchanging desktop", () => {
  const live = new DisplayLiveness(0)
  live.image(pulse(1), 0)
  live.input(1)
  for (let at = 1_000; at <= 30_000; at += 1_000) {
    live.image(pulse(at / 1_000 + 1), at)
    expect(live.alive(at)).toBe(true)
  }
})

test("fresh display monitors do not inherit a prior session's heartbeat or pending input", () => {
  const old = new DisplayLiveness(0)
  old.image(pulse(1), 0)
  old.input(1)
  expect(old.alive(30_000)).toBe(false)
  const fresh = new DisplayLiveness(30_000)
  fresh.image(black(), 30_000)
  expect(fresh.alive(60_000)).toBe(true)
})
