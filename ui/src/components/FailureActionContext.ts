import type { FailureAction } from "@touri/contracts/run-failure"
import { createContext } from "react"

export type FailureActionHandler = (action: FailureAction) => void

/** Lets a failure card open the exact setting, Doctor or service that fixes its cause. */
export const FailureActionContext = createContext<FailureActionHandler>(() => undefined)
