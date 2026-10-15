export const DISPLAY_STALE_MS = 8_000

/** Xvfb's empty root is black except for Touri's 8px heartbeat window. */
export const isEmptyDisplay = ({ data, width, height }: ImageData): boolean => {
  if (!width || !height || data.length !== width * height * 4) return false
  let painted = false
  for (let offset = 0; offset < data.length; offset += 4) {
    if (!data[offset + 3]) continue
    painted = true
    if (!data[offset] && !data[offset + 1] && !data[offset + 2]) continue
    const pixel = offset / 4
    if (
      pixel % width >= width - 8 &&
      Math.floor(pixel / width) >= height - 8 &&
      data[offset + 1] === 0x30 &&
      data[offset + 2] === 0x40
    )
      continue
    return false
  }
  return painted
}

/** Idle pixels are healthy. Watch an observed X11 pulse, or drawing after actual input. */
export class DisplayLiveness {
  private startedAt: number
  private lastPulse: number | null = null
  private pendingInput: number | null = null
  private pixel: number | null = null
  private previous: Uint8ClampedArray | null = null
  private width = 0
  private height = 0
  private painted = false

  constructor(at: number) {
    this.startedAt = at
  }

  input(at: number) {
    // Repeated input must not indefinitely postpone an unanswered input's deadline.
    this.pendingInput ??= at
  }

  image(image: ImageData, at: number): boolean {
    const { data, width, height } = image
    if (width === 0 || height === 0 || data.length !== width * height * 4) return false
    // noVNC's newly resized backbuffer is transparent; a painted black pixel is opaque.
    if (!this.painted) this.painted = data.some((value, offset) => offset % 4 === 3 && value !== 0)
    if (!this.painted) return false
    const previous = this.previous
    if (
      this.pendingInput !== null &&
      previous &&
      (width !== this.width || height !== this.height || data.some((value, offset) => value !== previous[offset]))
    )
      this.pendingInput = null
    if (!this.previous || this.previous.length !== data.length) this.previous = new Uint8ClampedArray(data.length)
    this.previous.set(data)
    this.width = width
    this.height = height

    if (width >= 8 && height >= 8) {
      const offset = ((height - 4) * width + width - 4) * 4
      const red = data[offset]
      if (red !== undefined && data[offset + 1] === 0x30 && data[offset + 2] === 0x40 && data[offset + 3] === 255) {
        if (this.pixel !== red) {
          this.pixel = red
          this.lastPulse = at
        }
      }
    }
    return true
  }

  alive(at: number): boolean {
    if (!this.painted) return at - this.startedAt < DISPLAY_STALE_MS
    return (
      (this.lastPulse === null || at - this.lastPulse < DISPLAY_STALE_MS) &&
      (this.pendingInput === null || at - this.pendingInput < DISPLAY_STALE_MS)
    )
  }
}
