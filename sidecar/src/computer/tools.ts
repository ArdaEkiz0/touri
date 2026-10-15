import type { ToolHandler, ToolRegistration } from "@touri/contracts"
import type { ComputerAccess, ComputerController } from "./controller"
import { isModifier, toScreenshotArgs } from "./controller"

type RecordArgs = Record<string, unknown>

const recordArgs = (args: unknown): RecordArgs =>
  typeof args === "object" && args !== null ? (args as RecordArgs) : {}
const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const asNumber = (value: unknown, fallback = 0): number => (typeof value === "number" ? value : fallback)
const asButton = (value: unknown): "left" | "right" | "middle" =>
  value === "right" || value === "middle" ? value : "left"
const asClickCount = (value: unknown): 1 | 2 | 3 => (value === 2 || value === 3 ? value : 1)
const asModifiers = (value: unknown): Array<"cmd" | "shift" | "alt" | "ctrl"> =>
  Array.isArray(value) ? value.filter(isModifier) : []

export const createComputerTools = ({ controller }: { controller: ComputerController }): Array<ToolRegistration> => {
  type Operation = (args: { access: ComputerAccess; args: unknown }) => Promise<import("@touri/contracts").ToolResult>
  const withExecution =
    (toolName: string, operation: Operation): ToolHandler =>
    ({ ctx, args }) =>
      controller.execute({ ctx, toolName, input: args, operation: (access) => operation({ access, args }) })

  return [
    {
      name: "computer_screenshot",
      group: "computer",
      handler: withExecution("computer_screenshot", ({ access, args }) => {
        const input = recordArgs(args)
        const regionValue = input.region
        const region =
          typeof regionValue === "object" && regionValue !== null
            ? (regionValue as { x: number; y: number; width: number; height: number })
            : undefined
        const screenshotInput =
          region === undefined
            ? toScreenshotArgs({ maxWidth: asNumber(input.maxWidth, 1440) })
            : toScreenshotArgs({ maxWidth: asNumber(input.maxWidth, 1440), region })
        return controller.screenshot({ access, input: screenshotInput })
      }),
    },
    {
      name: "computer_click",
      group: "computer",
      handler: withExecution("computer_click", ({ access, args }) => {
        const input = recordArgs(args)
        return controller.click({
          access,
          x: asNumber(input.x),
          y: asNumber(input.y),
          button: asButton(input.button),
          clickCount: asClickCount(input.clickCount),
          modifiers: asModifiers(input.modifiers),
        })
      }),
    },
    {
      name: "computer_type",
      group: "computer",
      handler: withExecution("computer_type", ({ access, args }) =>
        controller.type({ access, text: asString(recordArgs(args).text) }),
      ),
    },
    {
      name: "computer_key",
      group: "computer",
      handler: withExecution("computer_key", ({ access, args }) =>
        controller.key({ access, combo: asString(recordArgs(args).combo) }),
      ),
    },
    {
      name: "computer_scroll",
      group: "computer",
      handler: withExecution("computer_scroll", ({ access, args }) => {
        const input = recordArgs(args)
        return controller.scroll({
          access,
          x: asNumber(input.x),
          y: asNumber(input.y),
          dx: asNumber(input.dx),
          dy: asNumber(input.dy, 5),
        })
      }),
    },
    {
      name: "computer_frontmost",
      group: "computer",
      handler: withExecution("computer_frontmost", ({ access }) => controller.frontmost({ access })),
    },
  ]
}

export { recordArgs }
