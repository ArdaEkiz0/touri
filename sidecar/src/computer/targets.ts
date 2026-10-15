export type InputTarget = {
  app: string
  bundleId: string
  windowTitle: string | null
  processId?: number
  protectedRegions?: Array<{ x: number; y: number; width: number; height: number }>
}

export const protectedPoint = (target: InputTarget, point: { x: number; y: number }): boolean => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return true
  // Older/unavailable hosts fail closed when a protected app owns the foreground.
  if (!target.protectedRegions) return protectedTarget(target)
  return target.protectedRegions.some(
    (r) => point.x >= r.x && point.y >= r.y && point.x <= r.x + r.width && point.y <= r.y + r.height,
  )
}

export const protectedTarget = ({ app, bundleId }: InputTarget): boolean =>
  bundleId === "ai.touri.desktop" ||
  bundleId === "com.apple.systempreferences" ||
  bundleId === "com.apple.SecurityAgent" ||
  /^(touri|system settings|system preferences|ajustes do sistema)$/i.test(app)

export const terminalTarget = ({ app, bundleId }: InputTarget): boolean =>
  /terminal|iterm|warp|alacritty|kitty|wezterm|ghostty|hyper|tabby|term(?:ius|ora)/i.test(`${app} ${bundleId}`)

export const sameTarget = (a: InputTarget, b: InputTarget): boolean =>
  a.bundleId === b.bundleId && a.app === b.app && a.windowTitle === b.windowTitle && a.processId === b.processId
