import type { HighlighterCore, ThemedToken } from "shiki/core"
import { syntaxTheme } from "./syntaxTheme"

export type ToolLanguage = "shellscript" | "json" | "diff"
let highlighter: Promise<HighlighterCore> | undefined

// Load only tool grammars and the JS engine, without the full language/theme bundle or WASM.
const getHighlighter = () => {
  highlighter ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/langs/shellscript.mjs"),
    import("shiki/langs/json.mjs"),
    import("shiki/langs/diff.mjs"),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, shell, json, diff]) =>
    createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [shell.default, json.default, diff.default],
      themes: [syntaxTheme],
    }),
  )
  return highlighter
}

export const highlightToolCode = async (source: string, language: ToolLanguage): Promise<ThemedToken[][]> => {
  const engine = await getHighlighter()
  return engine.codeToTokensBase(source, { lang: language, theme: syntaxTheme.name }).map((line) =>
    line.flatMap((token) => {
      if (language !== "shellscript" || token.color !== "var(--text-code)") return [token]
      // Shell grammars classify unquoted paths as ordinary arguments. Give those paths their own role.
      const paths = /(?<![\w:/])(?:~\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s"'`;$|&()<>\\]+/g
      const result: ThemedToken[] = []
      let start = 0
      for (const match of token.content.matchAll(paths)) {
        if (match.index > start)
          result.push({ ...token, content: token.content.slice(start, match.index), offset: token.offset + start })
        result.push({ ...token, content: match[0], offset: token.offset + match.index, color: "var(--syntax-path)" })
        start = match.index + match[0].length
      }
      if (start < token.content.length)
        result.push({ ...token, content: token.content.slice(start), offset: token.offset + start })
      return result
    }),
  )
}
