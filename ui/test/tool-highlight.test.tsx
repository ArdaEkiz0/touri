import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { contrastAnsiColor } from "../src/components/ansiContrast"
import { parseAnsiOutput } from "../src/components/ansiOutput"
import { ToolCallCard } from "../src/components/ToolCallCard"
import { ToolText } from "../src/components/ToolOutput"
import { highlightToolCode } from "../src/components/toolHighlight"

afterEach(cleanup)

describe("tool code", () => {
  it("distinguishes shell commands, flags, paths, strings, operators and variables without changing source", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell parameter expansion.
    const source = 'NODE_ENV=test mkdir -p ./docs "$HOME/output" && printf \'%s\\n\' "${USER}" | tee /tmp/out'
    const tokens = (await highlightToolCode(source, "shellscript")).flat()
    expect(tokens.map((token) => token.content).join("")).toBe(source)
    for (const role of ["command", "flag", "path", "string", "operator", "variable"])
      expect(
        tokens.some((token) => token.color === `var(--syntax-${role})`),
        role,
      ).toBe(true)
    expect(tokens.find((token) => token.content === "mkdir")?.color).toBe("var(--syntax-command)")
    expect(tokens.find((token) => token.content === "./docs")?.color).toBe("var(--syntax-path)")
  })
  it("highlights JSON keys and values, and preserves multiline text including empty lines", async () => {
    const source = '{\n\n  "command": "mkdir -p ./docs",\n  "count": 2, "ok": true\n}\n'
    const lines = await highlightToolCode(source, "json")
    expect(lines.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(source)
    expect(lines.flat().some((token) => token.color === "var(--syntax-command)")).toBe(true)
    expect(lines.flat().some((token) => token.color === "var(--syntax-string)")).toBe(true)
  })
})

describe("ANSI output", () => {
  it("retains readable ANSI colors and adjusts low contrast pairs in both themes", () => {
    expect(contrastAnsiColor("rgb(255, 255, 255)", "rgb(21, 21, 22)")).toBe("rgb(255, 255, 255)")
    expect(contrastAnsiColor("rgb(0, 0, 0)", "rgb(246, 246, 244)")).toBe("rgb(0, 0, 0)")
    expect(contrastAnsiColor("rgb(0, 135, 255)", "rgb(246, 246, 244)")).not.toBe("rgb(0, 135, 255)")
    expect(contrastAnsiColor("rgb(12, 34, 56)", "rgb(21, 21, 22)")).not.toBe("rgb(12, 34, 56)")
  })
  it("handles attributes, normal/bright foregrounds, backgrounds and selective/full resets", () => {
    const spans = parseAnsiOutput(
      "\u001b[1;3;4;9;31;44mstyled\u001b[22;23;24;29;39;49mplain\u001b[92mbright\u001b[0mreset",
    )
    expect(spans.map((span) => span.text)).toEqual(["styled", "plain", "bright", "reset"])
    expect(spans[0]?.style).toMatchObject({
      color: "var(--ansi-red)",
      backgroundColor: "var(--ansi-blue)",
      fontWeight: 700,
      fontStyle: "italic",
      textDecoration: "underline line-through",
    })
    expect(spans[1]?.style.color).toBeUndefined()
    expect(spans[1]?.style.backgroundColor).toBeUndefined()
    expect(spans[1]?.style.fontWeight).toBeUndefined()
    expect(spans[2]?.style.color).toBe("var(--ansi-bright-green)")
    expect(spans[3]?.style.color).toBeUndefined()
  })
  it("supports 256 colors, truecolor, colon notation and C1 CSI, while rejecting invalid channels", () => {
    const spans = parseAnsiOutput(
      "\u001b[38;5;196ma\u001b[48;5;244mb\u001b[38;2;12;34;56mc\u001b[38:2::56:78:90md\u009b36me\u001b[0;38;2;999;0;0mf",
    )
    expect(spans[0]?.style.color).toBe("rgb(255, 0, 0)")
    expect(spans[1]?.style.backgroundColor).toBe("rgb(128, 128, 128)")
    expect(spans[2]?.style.color).toBe("rgb(12, 34, 56)")
    expect(spans[3]?.style.color).toBe("rgb(56, 78, 90)")
    expect(spans[4]?.style.color).toBe("var(--ansi-cyan)")
    expect(spans[5]?.style.color).toBeUndefined()
  })
  it("consumes unsupported controls, OSC URLs/titles and partial escape tails", () => {
    const source =
      "\u001b]0;title\u0007\u001b]8;;javascript:alert(1)\u001b\\label\u001b]8;;\u001b\\\u001b[2K text\u001b[31"
    expect(
      parseAnsiOutput(source)
        .map((span) => span.text)
        .join(""),
    ).toBe("label text")
  })
  it("renders hostile terminal text literally and expands long output without losing color", () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script>'
    const { container } = render(<ToolText text={`\u001b[32m${hostile}${"x".repeat(1250)}\u001b[0m`} />)
    expect(container.querySelector("img, script")).toBeNull()
    expect(container.querySelector("code")).toHaveTextContent(hostile)
    expect(container.querySelector("code")?.textContent?.length).toBe(1201)
    fireEvent.click(container.querySelector("button") as HTMLButtonElement)
    expect(container.querySelector("code")?.textContent?.length).toBe(hostile.length + 1250)
    expect(container.querySelector("code span")).toHaveAttribute("style", "color: var(--ansi-green);")
  })
  it("localizes an empty Bash result and still highlights redacted technical JSON", async () => {
    const { container } = render(
      <ToolCallCard
        part={{
          type: "tool_call",
          callId: "empty",
          tool: "Bash",
          summary: "Criar pasta",
          inputJson: '{"command":"mkdir -p ./docs","api_key":"sk-secret-test-value"}',
          outputJson: "(Bash completed with no output)",
          ok: true,
        }}
      />,
    )
    expect(container.querySelector(".tool-output code")).toHaveTextContent(/^Sem saída$/)
    expect(container).not.toHaveTextContent("sk-secret-test-value")
    await waitFor(() =>
      expect(container.querySelector(".tool-technical code")).toHaveAttribute("data-highlighted", "true"),
    )
    expect(container.querySelectorAll(".tool-technical code span").length).toBeGreaterThan(1)
  })
})
