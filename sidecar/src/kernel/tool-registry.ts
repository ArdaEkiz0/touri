import { type RegisterTools, type ToolRegistration, toolCatalog } from "@touri/contracts"

export const createToolRegistry = (): {
  registerTools: RegisterTools
  get: (name: string) => ToolRegistration | null
} => {
  const known = new Set(toolCatalog.tools.map((tool) => tool.name))
  const registrations = new Map<string, ToolRegistration>()
  const registerTools: RegisterTools = ({ tools }) => {
    for (const tool of tools) {
      if (!known.has(tool.name))
        return { success: false, errorCode: "UNKNOWN_TOOL", error: `Unknown tool ${tool.name}` }
      if (registrations.has(tool.name))
        return { success: false, errorCode: "DUPLICATE_TOOL", error: `Duplicate tool ${tool.name}` }
    }
    for (const tool of tools) registrations.set(tool.name, tool)
    return { success: true, count: tools.length }
  }
  return { registerTools, get: (name) => registrations.get(name) ?? null }
}
