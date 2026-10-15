import { useSyncExternalStore } from "react"

const key = "touri.inline-live-preview"
const change = "touri:inline-live-preview"
export const readInlinePreviewPreference = (): boolean => {
  try {
    return localStorage.getItem(key) !== "off"
  } catch {
    return true
  }
}
export const setInlinePreviewPreference = (enabled: boolean): void => {
  try {
    localStorage.setItem(key, enabled ? "on" : "off")
  } catch {
    // Storage can be unavailable in a private window.
  }
  window.dispatchEvent(new Event(change))
}
const subscribe = (listener: () => void) => {
  window.addEventListener(change, listener)
  window.addEventListener("storage", listener)
  return () => {
    window.removeEventListener(change, listener)
    window.removeEventListener("storage", listener)
  }
}
export const useInlinePreviewPreference = () => useSyncExternalStore(subscribe, readInlinePreviewPreference, () => true)
