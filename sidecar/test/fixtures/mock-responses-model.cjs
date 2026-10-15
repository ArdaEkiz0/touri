// A scripted OpenAI Responses endpoint for real Codex CLIs. It drives one browser
// sequence through Touri's MCP tools: browser_open, browser_snapshot, browser_screenshot.
// Usage: node mock-responses-model.cjs <port> <url> <logFile>
const http = require("node:http")
const fs = require("node:fs")

const [, , portArg, targetUrl, logFile] = process.argv
const record = (value) => fs.appendFileSync(logFile, `${JSON.stringify(value)}\n`)
const sse = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
let responses = 0

const outputText = (output) => (typeof output === "string" ? output : JSON.stringify(output))

const nextItem = (body, text) => {
  const outputs = (Array.isArray(body.input) ? body.input : []).filter((item) => item.type === "function_call_output")
  const tab = text.match(/\b(t_[0-9A-Z]{26})\b/)?.[1] ?? ""
  const call = (name, args) => ({
    type: "function_call",
    id: `fc_${outputs.length}`,
    call_id: `call_${outputs.length}`,
    namespace: "mcp__touri",
    name,
    arguments: JSON.stringify(args),
    status: "completed",
  })
  if (!text.includes("browser_open") || outputs.length >= 3)
    return {
      type: "message",
      id: `msg_${outputs.length}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Página aberta no navegador.", annotations: [] }],
    }
  if (outputs.length === 0) return call("browser_open", { url: targetUrl, timeoutMs: 20000 })
  if (outputs.length === 1) return call("browser_snapshot", { tabId: tab })
  return call("browser_screenshot", { tabId: tab })
}

const server = http.createServer((request, response) => {
  let raw = ""
  request.on("data", (chunk) => {
    raw += chunk
  })
  request.on("end", () => {
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {}
    const item = nextItem(body, raw)
    record({
      at: Date.now(),
      path: request.url,
      reply: item.type === "function_call" ? item.name : "message",
      outputs: (Array.isArray(body.input) ? body.input : [])
        .filter((entry) => entry.type === "function_call_output")
        .map((entry) => outputText(entry.output).slice(0, 4000)),
    })
    responses += 1
    const completed = {
      id: `resp_${responses}`,
      object: "response",
      status: "completed",
      output: [item],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(
      sse([
        { type: "response.created", response: { ...completed, status: "in_progress", output: [] } },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: completed },
      ]),
    )
  })
})
server.listen(Number(portArg), "127.0.0.1", () => record({ at: Date.now(), ready: true, port: server.address().port }))
