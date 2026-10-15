/** Lowercase, accent-free text so "configuracao" finds "Configuração". */
export const normalizeSearch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim()

const WORD_BOUNDARY = /[^\p{L}\p{N}]/u

const substringScore = (token: string, text: string): number => {
  const index = text.indexOf(token)
  if (index < 0) return 0
  if (index === 0) return 100
  return WORD_BOUNDARY.test(text[index - 1] ?? " ") ? 80 : 55
}

/** In-order characters with a bounded number of gaps; long, scattered matches are noise. */
const subsequenceScore = (token: string, text: string): number => {
  if (token.length < 3) return 0
  let position = -1
  let gaps = 0
  for (const char of token) {
    const next = text.indexOf(char, position + 1)
    if (next < 0) return 0
    if (position >= 0) gaps += next - position - 1
    position = next
  }
  if (gaps > token.length * 2) return 0
  return Math.max(5, 40 - gaps * 2)
}

export type SearchFields = {
  /** Normalized primary label: substring and fuzzy subsequence matches. */
  label: string
  /** Normalized secondary text (breadcrumbs, keywords, bot names): substring matches only. */
  extra: string
}

/** 0 means no match. Every query token must match the label or the secondary text. */
export const matchScore = (tokens: ReadonlyArray<string>, fields: SearchFields): number => {
  let total = 0
  for (const token of tokens) {
    const score = Math.max(
      substringScore(token, fields.label),
      subsequenceScore(token, fields.label),
      substringScore(token, fields.extra) * 0.5,
    )
    if (score === 0) return 0
    total += score
  }
  return total
}

export const queryTokens = (query: string): Array<string> => normalizeSearch(query).split(" ").filter(Boolean)
