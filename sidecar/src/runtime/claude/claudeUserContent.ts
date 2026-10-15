import type { TurnImage } from "../loadTurnImages"

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }

/** Claude stream-json user content: text first, then one base64 image block per attachment. */
export const claudeUserContent = ({
  text,
  images,
}: {
  text: string
  images: Array<TurnImage>
}): Array<ClaudeContentBlock> => [
  { type: "text", text },
  ...images.map(
    (image): ClaudeContentBlock => ({
      type: "image",
      source: { type: "base64", media_type: image.mime, data: image.base64 },
    }),
  ),
]
