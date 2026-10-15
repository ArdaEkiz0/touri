import type { StartTurnArgs } from "@touri/contracts"
import type { TurnImage } from "../loadTurnImages"

export type CodexInputItemsArgs = { input: StartTurnArgs["input"]; images: Array<TurnImage>; textPrefix?: string }
export type CodexInputItem = { type: "text"; text: string } | { type: "image"; url: string }

const dataUrl = (image: TurnImage): string => `data:${image.mime};base64,${image.base64}`

/**
 * Codex app-server `UserInput`: an image item is `{type:"image", url}` (data URL or https) or
 * `{type:"localImage", path}`. Anything else (for example an attachment id) fails with
 * "data did not match any variant of untagged enum ImageReference".
 */
export const codexInputItems = ({ input, images, textPrefix }: CodexInputItemsArgs): Array<CodexInputItem> => {
  const texts = input.flatMap((part) => (part.type === "text" ? [part.text] : []))
  const text = [textPrefix, ...texts].filter(Boolean).join("\n\n")
  return [{ type: "text", text }, ...images.map((image): CodexInputItem => ({ type: "image", url: dataUrl(image) }))]
}
