import type { CSSProperties } from "react"

export type AnsiSpan = { text: string; offset: number; style: CSSProperties }
type Sgr = {
  foreground?: string
  background?: string
  bold?: boolean
  faint?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  inverse?: boolean
}
const palette = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]
const paletteColor = (index: number): string | undefined =>
  index >= 0 && index < 16 ? `var(--ansi-${index >= 8 ? "bright-" : ""}${palette[index % 8]})` : undefined
const byte = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255
const indexedColor = (value: number): string | undefined => {
  if (!byte(value)) return undefined
  if (value < 16) return paletteColor(value)
  if (value >= 232) return `rgb(${[1, 2, 3].map(() => 8 + (value - 232) * 10).join(", ")})`
  const offset = value - 16
  const channel = (level: number) => (level === 0 ? 0 : 55 + level * 40)
  return `rgb(${[Math.floor(offset / 36), Math.floor(offset / 6) % 6, offset % 6].map(channel).join(", ")})`
}
const spanStyle = (state: Sgr): CSSProperties => ({
  color: state.inverse ? (state.background ?? "var(--surface-code)") : state.foreground,
  backgroundColor: state.inverse ? (state.foreground ?? "var(--text-code)") : state.background,
  fontWeight: state.bold ? 700 : undefined,
  opacity: state.faint ? 0.65 : undefined,
  fontStyle: state.italic ? "italic" : undefined,
  textDecoration:
    [state.underline ? "underline" : "", state.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
})

/** Terminal data becomes text nodes and validated CSS values; control sequences never become HTML. */
export const parseAnsiOutput = (source: string): AnsiSpan[] => {
  const spans: AnsiSpan[] = []
  let state: Sgr = {}
  let start = 0
  // Consume SGR, other CSI controls, OSC links/titles, and string controls (including partial tails).
  const controls =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: this parser intentionally consumes terminal control bytes.
    /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b\[|\x9b)[0-?]*$|\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\|$)|[PX^_][\s\S]*?(?:\x1b\\|$)|.|$)/g
  const append = (end: number) => {
    if (end > start) spans.push({ text: source.slice(start, end), offset: start, style: spanStyle(state) })
  }
  for (const match of source.matchAll(controls)) {
    append(match.index)
    const control = match[0]
    // biome-ignore lint/suspicious/noControlCharactersInRegex: identify only SGR sequences.
    const sgr = /^(?:\x1b\[|\x9b)([\d;:]*)m$/.exec(control)
    if (sgr) {
      const parameters = (sgr[1] ?? "").replace(/:2::/g, ":2:").split(/[;:]/).map(Number)
      for (let index = 0; index < parameters.length; index++) {
        const code = parameters[index] ?? 0
        if (code === 0) state = {}
        else if (code === 1) state.bold = true
        else if (code === 2) state.faint = true
        else if (code === 3) state.italic = true
        else if (code === 4) state.underline = true
        else if (code === 7) state.inverse = true
        else if (code === 9) state.strike = true
        else if (code === 22) {
          state.bold = false
          state.faint = false
        } else if (code === 23) state.italic = false
        else if (code === 24) state.underline = false
        else if (code === 27) state.inverse = false
        else if (code === 29) state.strike = false
        else if (code === 39) delete state.foreground
        else if (code === 49) delete state.background
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
          state.foreground = paletteColor(code >= 90 ? code - 82 : code - 30) ?? "var(--text-code)"
        else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107))
          state.background = paletteColor(code >= 100 ? code - 92 : code - 40) ?? "var(--surface-code)"
        else if (code === 38 || code === 48) {
          const mode = parameters[++index]
          let color: string | undefined
          if (mode === 5) color = indexedColor(parameters[++index] ?? -1)
          else if (mode === 2) {
            const rgb = parameters.slice(index + 1, index + 4)
            index += 3
            if (rgb.length === 3 && rgb.every(byte)) color = `rgb(${rgb.join(", ")})`
          }
          if (color) state[code === 38 ? "foreground" : "background"] = color
        }
      }
    }
    start = match.index + control.length
  }
  append(source.length)
  return spans
}
