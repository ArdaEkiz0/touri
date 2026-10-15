// Semantic colors resolve in either app theme and share the terminal's contrast palette.
export const syntaxTheme = {
  name: "touri-code",
  settings: [
    { settings: { foreground: "var(--text-code)", background: "var(--surface-code)" } },
    {
      scope: ["entity.name", "support.function", "support.type", "support.type.property-name.json"],
      settings: { foreground: "var(--syntax-command)" },
    },
    {
      scope: ["string.quoted", "string.template", "string.regexp", "punctuation.definition.string"],
      settings: { foreground: "var(--syntax-string)" },
    },
    { scope: ["constant.other.option", "constant.numeric"], settings: { foreground: "var(--syntax-flag)" } },
    {
      scope: ["variable", "punctuation.definition.variable", "constant.language"],
      settings: { foreground: "var(--syntax-variable)" },
    },
    {
      scope: ["keyword", "storage", "punctuation.separator.statement"],
      settings: { foreground: "var(--syntax-operator)" },
    },
    { scope: "comment", settings: { foreground: "var(--text-secondary)", fontStyle: "italic" } },
    { scope: "markup.inserted", settings: { foreground: "var(--text-success)" } },
    { scope: "markup.deleted", settings: { foreground: "var(--text-danger)" } },
    { scope: "meta.diff.header", settings: { foreground: "var(--text-link)" } },
  ],
}
