import type { AvatarShape } from "@touri/contracts"
import { AVATAR_COLOR_CHOICES, AVATAR_SHAPES, type AvatarIdentity, avatarProfileFor } from "@touri/contracts/avatar"
import { t } from "../i18n"
import { BotAvatar } from "./BotAvatar"

const SHAPE_LABEL: Record<AvatarShape, string> = {
  cercle: t("Circle"),
  galet: t("Pebble"),
  squircle: t("Squircle"),
  capsule: t("Capsule"),
  triangle: t("Triangle"),
  hexagone: t("Hexagon"),
  nuage: t("Cloud"),
  goutte: t("Drop"),
}
export type AvatarChoice = { avatarShape: AvatarShape; color: string | null }
export const AvatarPicker = ({
  bot,
  label = t("Avatar"),
  description = t("Make it yours"),
  onChange,
}: {
  bot: AvatarIdentity
  label?: string
  description?: string
  onChange: (choice: Partial<AvatarChoice>) => void
}) => {
  const profile = avatarProfileFor(bot)
  return (
    <fieldset className="avatar-picker">
      <legend>{label}</legend>
      <div className="avatar-picker-preview">
        <BotAvatar bot={bot} size={64} mood="idle" motion="always" followPointer />
        <span>{description}</span>
      </div>
      <fieldset className="avatar-shapes" aria-label={t("Silhouette")}>
        {AVATAR_SHAPES.map((shape) => (
          <button
            type="button"
            key={shape.id}
            aria-label={t("Avatar shape", { shape: SHAPE_LABEL[shape.id] })}
            aria-pressed={profile.shape === shape.id}
            onClick={() => onChange({ avatarShape: shape.id })}
          >
            <BotAvatar bot={{ ...bot, avatarShape: shape.id }} size={32} mood="idle" />
          </button>
        ))}
      </fieldset>
      <fieldset className="avatar-colors" aria-label={t("Color")}>
        <button
          type="button"
          className="avatar-color-auto"
          aria-label={t("Avatar color", { color: t("Automatic") })}
          aria-pressed={bot.color === null}
          onClick={() => onChange({ color: null })}
        >
          A
        </button>
        {AVATAR_COLOR_CHOICES.map((color) => (
          <button
            type="button"
            key={color.hue}
            aria-label={t("Avatar color", { color: t(color.label) })}
            aria-pressed={bot.color !== null && profile.color === color.hex}
            style={{ backgroundColor: color.hex }}
            onClick={() => onChange({ color: color.hex })}
          />
        ))}
      </fieldset>
    </fieldset>
  )
}
