import { createTauriInvoke, type TauriInvoke } from "./api/client"
import { browserSave } from "./browserSave"
import { userFacingError } from "./errors"

export type SaveFileOutcome =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string }

export const saveNoticeText = (outcome: SaveFileOutcome): string => {
  if (outcome.status === "saved") return `Salvo em ${outcome.path}`
  if (outcome.status === "cancelled") return ""
  return `Não foi possível salvar: ${outcome.message}`
}

const hasNativeShell = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

/** Saves bytes through the desktop shell's native save panel (never a webview download). */
export const saveFile = async (
  input: { name: string; base64: string },
  invoke: TauriInvoke = createTauriInvoke(),
): Promise<SaveFileOutcome> => {
  try {
    if (!hasNativeShell()) return browserSave(input)
    const result = await invoke("save_file", { name: input.name, dataBase64: input.base64 })
    if (!result?.path) return { status: "cancelled" }
    return { status: "saved", path: result.path }
  } catch (reason) {
    return { status: "failed", message: userFacingError(reason) }
  }
}

const CHUNK = 0x8000

const bytesBase64 = (bytes: Uint8Array): string => {
  const parts: string[] = []
  for (let offset = 0; offset < bytes.length; offset += CHUNK)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK)))
  return btoa(parts.join(""))
}

const blobBase64 = async (blob: Blob): Promise<string> =>
  typeof blob.arrayBuffer === "function" ? bytesBase64(new Uint8Array(await blob.arrayBuffer())) : readerBase64(blob)

const readerBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "")
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem"))
    reader.readAsDataURL(blob)
  })

export const saveBlob = async (blob: Blob, name: string, invoke?: TauriInvoke): Promise<SaveFileOutcome> =>
  saveFile({ name, base64: await blobBase64(blob) }, invoke)
