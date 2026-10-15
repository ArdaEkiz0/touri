/** System preference plus an optional host-level override; there is no app setting today. */
export const isMotionReduced = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduce"

export const observeMotionPreference = (change: () => void): (() => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)")
  media.addEventListener("change", change)
  const observer = new MutationObserver(change)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] })
  return () => {
    media.removeEventListener("change", change)
    observer.disconnect()
  }
}
