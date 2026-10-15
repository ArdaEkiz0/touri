type RGB = [number, number, number]
const rgb = (value: string): RGB | undefined => {
  const match = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\s*\)$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}
const luminance = (color: RGB): number =>
  color.reduce((sum, value, index) => {
    const channel = value / 255
    return (
      sum +
      (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) *
        ([0.2126, 0.7152, 0.0722][index] ?? 0)
    )
  }, 0)
const contrast = (a: RGB, b: RGB) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

/** Keep ANSI hues, adjusting brightness only when the requested pair fails WCAG AA. */
export const contrastAnsiColor = (foreground: string, background: string): string => {
  const fg = rgb(foreground)
  const bg = rgb(background)
  if (!fg || !bg || contrast(fg, bg) >= 4.5) return foreground
  const endpoint: RGB = contrast([0, 0, 0], bg) > contrast([255, 255, 255], bg) ? [0, 0, 0] : [255, 255, 255]
  const mix = (amount: number): RGB =>
    fg.map((channel, index) => Math.round(channel + ((endpoint[index] ?? 0) - channel) * amount)) as RGB
  let low = 0
  let high = 1
  for (let index = 0; index < 16; index++) {
    const middle = (low + high) / 2
    if (contrast(mix(middle), bg) >= 4.5) high = middle
    else low = middle
  }
  return `rgb(${mix(high).join(", ")})`
}
