import { invoke } from "@tauri-apps/api/core"
import type { ReactNode } from "react"

export const openCloudLink = (url: string) => {
  if ("__TAURI_INTERNALS__" in window) return invoke("open_external", { url })
  window.open(url, "_blank", "noopener,noreferrer")
  return Promise.resolve()
}

/** Open verified public web links in the user's browser when running in Tauri. */
export const CloudLink = ({
  href,
  children,
  className,
  onError,
}: {
  href: string
  children: ReactNode
  className: string
  onError: (error: unknown) => void
}) => (
  <a
    href={href}
    className={className}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => {
      if (!("__TAURI_INTERNALS__" in window)) return
      event.preventDefault()
      void invoke("open_external", { url: href }).catch(onError)
    }}
  >
    {children}
  </a>
)
