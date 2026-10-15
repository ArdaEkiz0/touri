export type ComposerKeyEvent = {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
  keyCode: number
}

export type ComposerKeyAction = "send" | "newline" | "none"

const IME_PROCESSING_KEY_CODE = 229

/**
 * Maps a keydown in the composer to an action. Enter and Cmd/Ctrl+Enter send, Shift+Enter inserts a newline,
 * and anything pressed while an IME composition is active is left alone so candidate selection never sends.
 */
export const composerKeyAction = (event: ComposerKeyEvent): ComposerKeyAction => {
  if (event.key !== "Enter") return "none"
  if (event.isComposing || event.keyCode === IME_PROCESSING_KEY_CODE) return "none"
  if (event.shiftKey) return "newline"
  if (event.altKey) return "newline"
  return "send"
}
