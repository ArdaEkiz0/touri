import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { installMotionTokens } from "./design/spring"
import { initializeTheme } from "./design/theme"
import { init } from "./index"
import "./styles.css"

installMotionTokens(document.documentElement)
initializeTheme()

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode>{init()}</StrictMode>)
