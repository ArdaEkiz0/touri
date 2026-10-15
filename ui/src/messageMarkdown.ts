import type { Message } from "@touri/contracts"

/** Recover only flattened GFM tables with a recognizable delimiter and complete rows.
 * This is a display projection: persisted bytes and streaming offsets stay untouched. */
export const recoverLegacyMarkdown = (source: string): string => {
  let fence: { character: string; length: number } | undefined
  return source
    .split("\n")
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker) {
        if (!fence) fence = { character: marker[0] ?? "", length: marker.length }
        else if (marker[0] === fence.character && marker.length >= fence.length && line.trim() === marker)
          fence = undefined
        return line
      }
      if (fence || line.includes("`") || /^ {4}|^\t/.test(line)) return line
      const delimiter = /\|(?:\s*:?-{3,}:?\s*\|){2,}/.exec(line)
      if (!delimiter) return line
      const columns = delimiter[0].split("|").length - 2
      const cells = Array.from({ length: columns }, () => String.raw`(?:\\.|[^|\\])*\|`).join("")
      const prefix = line.slice(0, delimiter.index)
      const header = new RegExp(String.raw`\|${cells}\s*$`).exec(prefix)
      if (!header) return line
      const rowPattern = new RegExp(String.raw`^\s*\|${cells}`)
      let tail = line.slice(delimiter.index + delimiter[0].length)
      const rows: string[] = []
      for (let row = rowPattern.exec(tail); row; row = rowPattern.exec(tail)) {
        rows.push(row[0].trim())
        tail = tail.slice(row[0].length)
      }
      if (!rows.length) return line
      const intro = prefix
        .slice(0, header.index)
        .trimEnd()
        .replace(/([.!?])(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g, "$1\n\n")
      const outro = tail.trim().replace(/\s+·\s+/g, "\n- ")
      return [intro, [header[0].trim(), delimiter[0], ...rows].join("\n"), outro].filter(Boolean).join("\n\n")
    })
    .join("\n")
}

export const messageMarkdown = (message: Pick<Message, "role" | "text" | "parts">): string => {
  const segments = message.parts.filter((part) => part.type === "text").map((part) => part.text)
  if (message.role !== "assistant") return message.text || segments.join("")
  // Older snapshots retain separate parts even when their cached text has no separators.
  const text = segments.length > 1 ? segments.join("\n\n") : message.text || segments.join("")
  return recoverLegacyMarkdown(text)
}
