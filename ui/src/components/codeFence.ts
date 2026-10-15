/** A serialized code block must outlast every backtick run in its literal source. */
export const fenceCode = (source: string, language: string): string => {
  const longest = Math.max(2, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length))
  const fence = "`".repeat(longest + 1)
  return `${fence}${language}\n${source}\n${fence}`
}

// A unified diff's context line starts with a space. Markdown considers a context
// line containing ``` a closing fence, so secure the enclosing fence first.
export const protectDiffFences = (content: string): string =>
  content.replace(/^(`{3,})diff[^\n]*\n([\s\S]*?)^\1[ \t]*$/gm, (_block, _fence, source: string) =>
    fenceCode(source.replace(/\n$/, ""), "diff"),
  )
