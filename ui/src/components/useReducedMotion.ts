import { useEffect, useState } from "react"

export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const change = (): void => setReduced(media.matches)
    media.addEventListener("change", change)
    change()
    return () => media.removeEventListener("change", change)
  }, [])
  return reduced
}
