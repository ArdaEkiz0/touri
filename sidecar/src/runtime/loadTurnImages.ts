import type { Database } from "bun:sqlite"
import type { Kernel, StartTurnArgs } from "@touri/contracts"
import { readPrivateFile } from "../kernel/files"

export const IMAGE_UNAVAILABLE_MESSAGE = "A imagem anexada não está mais disponível. Anexe a imagem de novo."
const MAX_IMAGE_BYTES = 20_000_000
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/

export type LoadTurnImagesArgs = { kernel: Kernel; input: StartTurnArgs["input"] }
export type TurnImage = { attachmentId: string; mime: string; base64: string }
export type LoadTurnImagesSuccess = { success: true; images: Array<TurnImage> }
export type LoadTurnImagesError = { success: false; errorCode: "tool_error"; error: string }
export type LoadTurnImagesResult = LoadTurnImagesSuccess | LoadTurnImagesError

const loadOne = ({ kernel, attachmentId }: { kernel: Kernel; attachmentId: string }): TurnImage | null => {
  const row = (kernel.db as Database).query("SELECT path, mime FROM attachments WHERE id = ?").get(attachmentId) as {
    path: string
    mime: string
  } | null
  if (!row || !IMAGE_MIME.test(row.mime)) return null
  const bytes = readPrivateFile({ root: kernel.paths.appData, path: row.path, maxBytes: MAX_IMAGE_BYTES })
  return bytes ? { attachmentId, mime: row.mime, base64: bytes.toString("base64") } : null
}

/** Read every image part of a turn as bytes the provider can receive inline (works for host and VM runs alike). */
export const loadTurnImages = ({ kernel, input }: LoadTurnImagesArgs): LoadTurnImagesResult => {
  const images = input.flatMap((part) =>
    part.type === "image" ? [loadOne({ kernel, attachmentId: part.attachmentId })] : [],
  )
  const loaded = images.filter((image): image is TurnImage => image !== null)
  if (loaded.length !== images.length)
    return { success: false, errorCode: "tool_error", error: IMAGE_UNAVAILABLE_MESSAGE }
  return { success: true, images: loaded }
}
