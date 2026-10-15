import { createElement, type ReactElement } from "react"

import App, { type UiKernel } from "./App"

export const init = (kernel: UiKernel = {}): ReactElement => createElement(App, { kernel })
