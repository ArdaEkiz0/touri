import { expect, test } from "bun:test"
import { exposeOnTailscale, parseDnsName, proxyTargetsForPort, type RunCommand } from "../../src/cli/tailscale"

const statusJson = JSON.stringify({ Self: { DNSName: "box.tailnet-example.ts.net." } })

const fakeRun = ({ serveConfig }: { serveConfig: unknown }): { run: RunCommand; calls: Array<Array<string>> } => {
  const calls: Array<Array<string>> = []
  const run: RunCommand = async (_cmd, args) => {
    calls.push(args)
    if (args[0] === "status") return { code: 0, stdout: statusJson, stderr: "" }
    if (args[0] === "serve" && args[1] === "status") return { code: 0, stdout: JSON.stringify(serveConfig), stderr: "" }
    return { code: 0, stdout: "", stderr: "" }
  }
  return { run, calls }
}

const existing = {
  Web: {
    "box.tailnet-example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
    "box.tailnet-example.ts.net:8444": { Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } } },
  },
}

test("adds only its own https port and never touches the others or funnel", async () => {
  const { run, calls } = fakeRun({ serveConfig: existing })
  const result = await exposeOnTailscale({ localPort: 8795, run })
  expect(result).toEqual({ success: true, url: "https://box.tailnet-example.ts.net:8445/", alreadyConfigured: false })
  const mutating = calls.filter((args) => args[0] === "serve" && args[1] !== "status")
  expect(mutating).toEqual([["serve", "--bg", "--https=8445", "http://127.0.0.1:8795"]])
  expect(calls.flat()).not.toContain("funnel")
})

test("is idempotent when 8445 already points at this server", async () => {
  const config = { Web: { "h:8445": { Handlers: { "/": { Proxy: "http://127.0.0.1:8795" } } } } }
  const { run, calls } = fakeRun({ serveConfig: config })
  const result = await exposeOnTailscale({ localPort: 8795, run })
  expect(result).toMatchObject({ success: true, alreadyConfigured: true })
  expect(calls.some((args) => args.includes("--bg"))).toBe(false)
})

test("refuses to take over a port that serves something else", async () => {
  const config = { Web: { "h:8445": { Handlers: { "/": { Proxy: "http://127.0.0.1:1234" } } } } }
  const { run, calls } = fakeRun({ serveConfig: config })
  const result = await exposeOnTailscale({ localPort: 8795, run })
  expect(result.success).toBe(false)
  expect(calls.some((args) => args.includes("--bg"))).toBe(false)
})

test("parsers tolerate junk", () => {
  expect(parseDnsName("not json")).toBeNull()
  expect(parseDnsName(statusJson)).toBe("box.tailnet-example.ts.net")
  expect(proxyTargetsForPort({ config: {}, port: 8445 })).toEqual([])
})
