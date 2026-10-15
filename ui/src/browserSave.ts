/**
 * Plain-browser fallback only (server mode, no desktop shell). The desktop app never reaches this:
 * `saveFile` routes to the native `save_file` command whenever `__TAURI_INTERNALS__` exists.
 */
export const browserSave = (input: { name: string; base64: string }): { status: "cancelled" } => {
  const bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes]))
  const link = document.createElement("a")
  link.href = url
  link.setAttribute("download", input.name)
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { status: "cancelled" }
}
