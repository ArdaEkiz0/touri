const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const TIME_LENGTH = 10
const RANDOM_LENGTH = 16
const RANDOM_BYTES = 10

type UlidState = { time: number; random: Array<number> }

const state: UlidState = { time: -1, random: [] }

const encodeTime = (time: number): string =>
  Array.from({ length: TIME_LENGTH }, (_, index) => {
    const shift = 5 * (TIME_LENGTH - 1 - index)
    return ALPHABET[Math.floor(time / 2 ** shift) % 32] ?? "0"
  }).join("")

const randomDigits = (): Array<number> => {
  const bytes = new Uint8Array(RANDOM_BYTES)
  crypto.getRandomValues(bytes)
  const bits = Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join("")
  return Array.from({ length: RANDOM_LENGTH }, (_, index) => Number.parseInt(bits.slice(index * 5, index * 5 + 5), 2))
}

const incrementDigits = (digits: Array<number>): Array<number> => {
  const next = [...digits]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if ((next[index] ?? 0) < 31) {
      next[index] = (next[index] ?? 0) + 1
      return next
    }
    next[index] = 0
  }
  return next
}

/** Returns a Crockford base32 ULID (48-bit ms time + 80 random bits), monotonic within one millisecond. */
export const newId = (): string => {
  const now = Date.now()
  state.random = now === state.time ? incrementDigits(state.random) : randomDigits()
  state.time = now
  return `${encodeTime(now)}${state.random.map((digit) => ALPHABET[digit] ?? "0").join("")}`
}
