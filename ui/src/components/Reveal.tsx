import { type CSSProperties, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react"
import { isMotionReduced, observeMotionPreference } from "../design/motionPreference"

/** Every reveal property derives from one interpolated scalar. */
export const useReveal = <T extends HTMLElement>(visible = true) => {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (isMotionReduced() || !visible) {
      element.style.setProperty("--reveal", visible ? "1" : "0")
      return
    }
    getComputedStyle(element).getPropertyValue("--reveal")
    const frame = requestAnimationFrame(() => element.style.setProperty("--reveal", "1"))
    const stop = observeMotionPreference(() => {
      if (isMotionReduced()) {
        cancelAnimationFrame(frame)
        element.style.setProperty("--reveal", visible ? "1" : "0")
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      stop()
    }
  }, [visible])
  return ref
}

const useDisclosureSize = () => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const content = ref.current
    if (!content) return
    const measure = (): void => {
      content.parentElement?.style.setProperty("--disclosure-size", `${content.getBoundingClientRect().height}px`)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(content)
    return () => observer?.disconnect()
  }, [])
  return ref
}

/** Native summary keeps Enter/Space activation and the transcript's reading anchor. */
export const RevealDetails = ({
  className,
  summary,
  children,
}: {
  className: string
  summary: ReactNode
  children: ReactNode
}) => {
  const [expanded, setExpanded] = useState(false)
  const revealRef = useReveal<HTMLDivElement>(expanded)
  const contentRef = useDisclosureSize()
  return (
    <details className={className} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {/* Native details owns accessibility; its toggle state only drives visual interpolation. */}
      <div ref={revealRef} className="disclosure-reveal">
        <div ref={contentRef} className="disclosure-content">
          {children}
        </div>
      </div>
    </details>
  )
}

export const AnimatedDisclosure = ({
  className,
  summary,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
}: {
  className?: string
  summary: ReactNode
  children: ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) => {
  const [localExpanded, setExpanded] = useState(defaultExpanded)
  const expanded = controlledExpanded ?? localExpanded
  const contentId = useId()
  const contentRef = useDisclosureSize()
  return (
    <div className={`animated-disclosure ${className ?? ""}`} data-expanded={expanded}>
      <button
        type="button"
        className="disclosure-summary"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => {
          setExpanded(!expanded)
          onExpandedChange?.(!expanded)
        }}
      >
        <span aria-hidden="true" className="disclosure-chevron">
          ▸
        </span>
        {summary}
      </button>
      <div
        id={contentId}
        className="disclosure-reveal"
        style={{ "--reveal": expanded ? 1 : 0 } as CSSProperties}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <div ref={contentRef} className="disclosure-content">
          {children}
        </div>
      </div>
    </div>
  )
}
