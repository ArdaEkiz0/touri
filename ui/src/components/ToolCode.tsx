import { Fragment, useEffect, useState } from "react"
import type { ThemedToken } from "shiki/core"
import { highlightToolCode, type ToolLanguage } from "./toolHighlight"

export const ToolCode = ({ text, language }: { text: string; language: ToolLanguage }) => {
  const [highlighted, setHighlighted] = useState<{ text: string; language: ToolLanguage; lines: ThemedToken[][] }>()
  useEffect(() => {
    let active = true
    void highlightToolCode(text, language)
      .then((lines) => {
        if (active) setHighlighted({ text, language, lines })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [text, language])
  const lines = highlighted?.text === text && highlighted.language === language ? highlighted.lines : undefined
  return (
    <code data-highlighted={Boolean(lines)}>
      {lines
        ? lines.map((line, index) => (
            <Fragment key={line[0]?.offset ?? `empty-${index}`}>
              {index > 0 ? "\n" : ""}
              {line.map((token) => (
                <span
                  key={token.offset}
                  style={{
                    color: token.color,
                    fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
                  }}
                >
                  {token.content}
                </span>
              ))}
            </Fragment>
          ))
        : text}
    </code>
  )
}
