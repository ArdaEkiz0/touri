import { createHash, randomUUID } from "node:crypto"
import type {
  CloudCapabilities,
  CloudConnection,
  CloudMachine,
  CloudOperation,
  CloudTokens,
  CloudUsage,
  Message,
  Run,
  UiEvent,
} from "@touri/contracts"
import type { ServerWebSocket } from "bun"
import { vncResponse } from "../../sidecar/src/vm/vnc-auth"

type Device = { id: string; accountId: string; revoked: boolean; refresh: string; used: Set<string> }
type SocketData = {
  device: Device
  kind: "events" | "process" | "cdp" | "desktop" | "pty"
  machineId?: string
  generation?: number
  processId?: string
  phase?: number
  control?: boolean
  since?: number
}
type BotConfig = {
  id: string
  name: string
  provider: "codex" | "claude"
  mainThreadId: string
  instructions: string
  computerUse: boolean
  accountId: string
  apiKey?: string
}
const failure = (code: string, status: number) =>
  Response.json(
    { code, message: "Erro de sandbox", retryable: [429, 503].includes(status), requestId: randomUUID() },
    { status, headers: { "Touri-Cloud-Version": "1" } },
  )

/** Public, in-memory interoperability fixture. No containers, cloud credentials or private code. */
export const createFakeCloud = () => {
  let timeOffset = 0
  let protocolVersion = "1"
  let sandbox = true
  let descriptorOrigin: string | null = null
  let descriptorGeneration: number | null = null
  let descriptorExpired = false
  const now = () => Date.now() + timeOffset
  const iso = (ms = now()) => new Date(ms).toISOString()
  const pairings = new Map<
    string,
    { userCode: string; accountId: string; expires: number; approved: boolean; used: boolean; lastPoll: number }
  >()
  const devices = new Map<string, Device>()
  const access = new Map<string, { device: Device; expires: number }>()
  const bots = new Map<string, BotConfig>()
  const machines = new Map<string, CloudMachine & { accountId: string }>()
  const operations = new Map<string, CloudOperation & { accountId: string; final: CloudMachine; polls: number }>()
  const messages = new Map<string, Message[]>()
  const runs = new Map<string, Run>()
  const processRecords = new Map<
    string,
    { device: Device; machineId: string; generation: number; stdin: string; command: string; canceled: boolean }
  >()
  const idempotency = new Map<string, { body: string; status: number; value: unknown }>()
  const events: Array<{ cursor: string; botId: string; generation: number; event: UiEvent; accountId: string }> = []
  const sockets = new Set<ServerWebSocket<SocketData>>()
  const calls: Array<{ method: string; path: string; authenticated: boolean }> = []
  const transitions: Array<{ id: string; state: string }> = []
  const volumes = new Map<string, string>()
  const snapshots = new Map<string, { value: string; accountId: string }>()
  const desktopSessions = new Map<
    string,
    { device: Device; machineId: string; generation: number; control: boolean; used: boolean; expires: number }
  >()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const usage = (): CloudUsage => ({
    usedSeconds: 7200,
    includedSeconds: 72000,
    storageBytes: 1024 ** 3,
    storageLimitBytes: 10 * 1024 ** 3,
    updatedAt: iso(),
  })
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "Touri-Cloud-Version": protocolVersion } })
  const publicMachine = (value: CloudMachine): CloudMachine => ({
    id: value.id,
    botId: value.botId,
    generation: value.generation,
    state: value.state,
    imageVersion: value.imageVersion,
    volumeId: value.volumeId,
    progress: value.progress,
    usage: value.usage,
  })
  const emit = (value: CloudMachine, event: UiEvent) => {
    const accountId = machines.get(value.id)?.accountId ?? "account-a"
    const frame = {
      cursor: String(events.length + 1),
      botId: value.botId,
      generation: value.generation,
      event,
      accountId,
    }
    events.push(frame)
    for (const socket of sockets)
      if (socket.data.kind === "events" && socket.data.device.accountId === accountId)
        socket.send(JSON.stringify({ ...frame, accountId: undefined }))
  }
  const stateEvent = (value: CloudMachine) =>
    emit(value, {
      type: "machine.updated",
      machine: {
        botId: value.botId,
        status:
          value.state === "running"
            ? "running"
            : ["waking", "provisioning", "parking"].includes(value.state)
              ? "starting"
              : "stopped",
        progress: value.progress,
        error: null,
        memoryMb: 2048,
        createdMs: null,
        startMs: null,
        cloud: { state: value.state, generation: value.generation, usage: value.usage },
      },
    })
  const tokens = (device: Device): CloudTokens => {
    const accessToken = randomUUID()
    const refreshToken = randomUUID()
    device.refresh = refreshToken
    access.set(accessToken, { device, expires: now() + 300_000 })
    return { deviceId: device.id, accessToken, refreshToken, expiresAt: iso(now() + 300_000) }
  }
  const revoke = (device: Device) => {
    device.revoked = true
    for (const socket of sockets) if (socket.data.device === device) socket.close(1008, "Revogado")
  }
  const authenticated = (req: Request) => {
    const value = access.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")
    return value && !value.device.revoked && value.expires > now() ? value.device : null
  }
  const job = (
    value: CloudMachine & { accountId: string },
    state: CloudMachine["state"],
    pending: CloudMachine["state"],
  ) => {
    value.state = pending
    transitions.push({ id: value.id, state: pending })
    stateEvent(value)
    const generation = state === "running" ? value.generation + 1 : value.generation
    const final = { ...publicMachine(value), state, generation, progress: null }
    const operationId = randomUUID()
    const operation = {
      operationId,
      status: "pending" as const,
      machine: publicMachine(value),
      accountId: value.accountId,
      final,
      polls: 0,
    }
    operations.set(operationId, operation)
    return { operationId, status: "pending", machine: publicMachine(value) }
  }
  const server: import("bun").Server<SocketData> = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req, server): Promise<Response | undefined> {
      const url = new URL(req.url)
      const parts = url.pathname.split("/").filter(Boolean)
      const path = url.pathname
      const device = authenticated(req)
      calls.push({ method: req.method, path, authenticated: !!device })
      if (req.headers.get("Touri-Cloud-Version") !== "1" || url.searchParams.has("token"))
        return failure("TOURI-E9007", 400)
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (!device) return failure("TOURI-E9001", 401)
        const data: SocketData = { device, kind: "events", since: Number(url.searchParams.get("since") ?? 0) }
        if (path !== "/v1/events") {
          const value = machines.get(parts[2] ?? "")
          if (!value || value.accountId !== device.accountId) return failure("TOURI-E9003", 404)
          if (value.state !== "running" || Number(url.searchParams.get("generation")) !== value.generation)
            return failure("TOURI-E9005", 409)
          data.machineId = value.id
          data.generation = value.generation
          if (parts[3] === "processes") {
            data.kind = "process"
            data.processId = parts[4] ?? ""
            const record = processRecords.get(parts[4] ?? "")
            if (!record || record.device !== device) return failure("TOURI-E9003", 404)
          } else if (parts[3] === "desktop-sessions") {
            const session = desktopSessions.get(parts[4] ?? "")
            if (!session || session.used || session.device !== device || session.expires < now())
              return failure("TOURI-E9001", 401)
            session.used = true
            data.kind = "desktop"
            data.control = session.control
            data.phase = 0
          } else data.kind = parts[3] === "pty" ? "pty" : "cdp"
        }
        if (server.upgrade(req, { data })) return
        return failure("TOURI-E9000", 400)
      }
      if (path === "/v1/reports" && req.method === "POST") {
        if (!device) return failure("TOURI-E9001", 401)
        const key = req.headers.get("Idempotency-Key")
        if (!key) return failure("TOURI-E9007", 400)
        if (Number(req.headers.get("Content-Length")) > 10 * 1024 * 1024 + 65536) return failure("TOURI-E1005", 413)
        let form: FormData
        try {
          form = await req.formData()
        } catch {
          return failure("TOURI-E9007", 400)
        }
        const file = form.get("report")
        if (!(file instanceof File) || file.type !== "application/zip" || form.getAll("report").length !== 1)
          return failure("TOURI-E9007", 400)
        if (file.size > 10 * 1024 * 1024) return failure("TOURI-E1005", 413)
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (bytes[0] !== 80 || bytes[1] !== 75) return failure("TOURI-E9007", 400)
        const fingerprint = `POST /v1/reports ${createHash("sha256").update(bytes).digest("hex")}`
        const idemKey = `${device.accountId}:${key}`
        const prior = idempotency.get(idemKey)
        if (prior) return prior.body === fingerprint ? json(prior.value, prior.status) : failure("TOURI-E9005", 409)
        const value = { id: randomUUID() }
        idempotency.set(idemKey, { body: fingerprint, status: 201, value })
        return json(value, 201)
      }
      const body = req.method === "GET" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      if (path === "/v1/capabilities")
        return json({
          protocolVersion: Number(protocolVersion),
          sandbox,
          runtime: "whole-bot",
          auth: "byok-api",
          imageVersions: ["sandbox-v1"],
          capabilities: ["exec", "processes", "snapshots", "volumes", "desktop", "pty", "cdp", "preview"],
        } satisfies Omit<CloudCapabilities, "sandbox" | "protocolVersion"> & {
          sandbox: boolean
          protocolVersion: number
        })
      if (path === "/v1/device/authorizations") {
        const deviceCode = randomUUID()
        const userCode = randomUUID().slice(0, 8).toUpperCase()
        pairings.set(deviceCode, {
          userCode,
          accountId: "account-a",
          expires: now() + 600_000,
          approved: false,
          used: false,
          lastPoll: now() - 5000,
        })
        return json({
          deviceCode,
          userCode,
          verificationUri: `${baseUrl}/v1/device/verify`,
          expiresAt: iso(now() + 600_000),
          intervalSeconds: 5,
        })
      }
      if (path === "/v1/device/token") {
        const pair = pairings.get(String(body.deviceCode))
        if (!pair || pair.used || pair.expires <= now()) return failure("TOURI-E9011", 401)
        if (now() - pair.lastPoll < 5000) return failure("TOURI-E9006", 429)
        pair.lastPoll = now()
        if (!pair.approved) return failure("TOURI-E9010", 428)
        pair.used = true
        const device: Device = {
          id: randomUUID(),
          accountId: pair.accountId,
          revoked: false,
          refresh: "",
          used: new Set(),
        }
        devices.set(device.id, device)
        return json(tokens(device))
      }
      if (path === "/v1/tokens/refresh") {
        const old = String(body.refreshToken)
        const device = [...devices.values()].find((value) => value.refresh === old || value.used.has(old))
        if (!device || device.revoked) return failure("TOURI-E9001", 401)
        if (device.used.has(old)) {
          revoke(device)
          return failure("TOURI-E9001", 401)
        }
        device.used.add(old)
        return json(tokens(device))
      }
      if (!device) return failure("TOURI-E9001", 401)
      const idem = req.headers.get("Idempotency-Key")
      const fingerprint = `${req.method} ${path} ${JSON.stringify(body)}`
      const idemKey = `${device.accountId}:${idem}`
      if (req.method !== "GET") {
        if (!idem) return failure("TOURI-E9007", 400)
        const prior = idempotency.get(idemKey)
        if (prior) return prior.body === fingerprint ? json(prior.value, prior.status) : failure("TOURI-E9005", 409)
      }
      const success = (value: unknown, status = 200) => {
        if (idem && req.method !== "GET") idempotency.set(idemKey, { body: fingerprint, status, value })
        return json(value, status)
      }
      if (path === "/v1/account")
        return json({ id: device.accountId, name: "Conta de demonstração", role: "owner", deviceId: device.id })
      if (path === "/v1/plan")
        return json({
          name: "Cloud Solo · sandbox",
          priceCentavos: 7999,
          currency: "BRL",
          status: "active",
          includedSeconds: 72000,
          storageBytes: 10 * 1024 ** 3,
          subscribeUrl: `${baseUrl}/v1/subscribe`,
          sandbox: true,
        })
      if (path === "/v1/usage") return json(usage())
      if (parts[1] === "devices" && req.method === "DELETE") {
        const target = devices.get(parts[2] ?? "")
        if (!target || target.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        revoke(target)
        return success({})
      }
      if (parts[1] === "bots") {
        const id = parts[2] ?? String(body.id)
        if (req.method === "POST" && parts.length === 2) {
          if (body.auth !== "byok-api") return failure("TOURI-E9014", 403)
          bots.set(id, { ...body, id, accountId: device.accountId } as BotConfig)
          messages.set(String(body.mainThreadId), [])
          return success({ id }, 201)
        }
        const bot = bots.get(id)
        if (!bot || bot.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        if (req.method === "DELETE" && parts.length === 3) {
          if (body.confirm !== true) return failure("TOURI-E9005", 409)
          for (const value of machines.values())
            if (value.botId === bot.id) {
              value.state = "deleted"
              stateEvent(value)
            }
          bots.delete(id)
          return success({})
        }
        if (parts[3] === "key" && req.method === "PUT") {
          if (typeof body.apiKey !== "string" || !body.apiKey.trim()) return failure("TOURI-E9014", 403)
          bot.apiKey = body.apiKey
          return success({})
        }
        if (req.method === "PATCH") {
          Object.assign(bot, body)
          return success({})
        }
        if (parts[3] === "messages") {
          if (!bot.apiKey) return failure("TOURI-E9014", 403)
          const value = [...machines.values()].find((value) => value.botId === bot.id)
          if (!value) return failure("TOURI-E9003", 404)
          const threadId = String(body.threadId)
          const message: Message = {
            id: randomUUID(),
            threadId,
            parentId: null,
            role: "user",
            parts: [{ type: "text", text: String(body.text) }],
            text: String(body.text),
            status: "complete",
            kind: "text",
            sender: null,
            runId: null,
            source: "local",
            createdAt: now(),
            updatedAt: now(),
          }
          const run: Run = {
            id: randomUUID(),
            botId: bot.id,
            threadId,
            provider: bot.provider,
            trigger: "user",
            requestMessageId: message.id,
            replyMessageId: null,
            externalTurnId: null,
            status: "running",
            errorClass: null,
            errorMessage: null,
            usage: null,
            routineRunId: null,
            startedAt: now(),
            finishedAt: null,
            queuedAt: now(),
          }
          runs.set(run.id, run)
          messages.get(threadId)?.push(message)
          emit(value, { type: "message.created", message })
          const timer = setTimeout(() => {
            timers.delete(timer)
            if (run.status === "canceled") return
            run.status = "succeeded"
            run.finishedAt = now()
            const reply: Message = {
              ...message,
              id: randomUUID(),
              role: "assistant",
              text: "Turno concluído no runtime remoto.",
              parts: [{ type: "text", text: "Turno concluído no runtime remoto." }],
              parentId: message.id,
              runId: run.id,
            }
            run.replyMessageId = reply.id
            messages.get(threadId)?.push(reply)
            emit(value, { type: "message.created", message: reply })
            emit(value, { type: "run.updated", run })
          }, 30)
          timers.add(timer)
          return success({ message, run })
        }
        if (parts[3] === "files" && req.method === "PUT") return failure("TOURI-E9009", 501)
      }
      if (parts[1] === "threads") {
        const bot = [...bots.values()].find(
          (bot) => bot.mainThreadId === parts[2] && bot.accountId === device.accountId,
        )
        if (!bot) return failure("TOURI-E9003", 404)
        if (parts[3] === "messages")
          return json({
            messages: messages.get(parts[2] ?? "") ?? [],
            activeLeafId: messages.get(parts[2] ?? "")?.at(-1)?.id ?? null,
          })
        if (parts[3] === "transcript")
          return json({ entries: [], lastSeq: 0, generation: 1, hasMore: false, resync: true })
        if (parts[3] === "runs") return json({ runs: [...runs.values()].filter((run) => run.threadId === parts[2]) })
      }
      if (parts[1] === "runs" && parts[3] === "cancel") {
        const run = runs.get(parts[2] ?? "")
        if (!run || bots.get(run.botId)?.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        run.status = "canceled"
        return success({ run })
      }
      if (parts[1] === "operations") {
        const operation = operations.get(parts[2] ?? "")
        if (!operation || operation.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        operation.polls += 1
        if (operation.polls >= 1) {
          operation.status = "succeeded"
          operation.machine = operation.final
          const value = machines.get(operation.final.id)
          if (value) {
            Object.assign(value, operation.final)
            transitions.push({ id: value.id, state: value.state })
            stateEvent(value)
            for (const socket of sockets)
              if (
                socket.data.machineId === value.id &&
                (socket.data.generation !== value.generation || value.state !== "running")
              )
                socket.close(1008)
          }
        }
        return json({ operationId: operation.operationId, status: operation.status, machine: operation.machine })
      }
      if (path === "/v1/machines" && req.method === "POST") {
        const botId = String(body.botId)
        if (body.imageVersion !== "sandbox-v1" || body.size !== "small" || body.env || body.volumes || body.ports)
          return failure("TOURI-E9014", 403)
        if (!bots.has(botId) || bots.get(botId)?.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        if (!bots.get(botId)?.apiKey) return failure("TOURI-E9014", 403)
        const value = {
          id: randomUUID(),
          botId,
          state: "provisioning" as const,
          generation: 0,
          imageVersion: "sandbox-v1",
          volumeId: randomUUID(),
          progress: null,
          usage: usage(),
          accountId: device.accountId,
        }
        machines.set(value.id, value)
        return success(job(value, "running", "provisioning"), 202)
      }
      if (parts[1] === "machines") {
        const value = machines.get(parts[2] ?? "")
        if (!value || value.accountId !== device.accountId) return failure("TOURI-E9003", 404)
        const operation = parts[3]
        if (req.method === "GET" && !operation) return json(publicMachine(value))
        if (operation === "intent") return success({ accepted: true })
        if (body.generation !== undefined && body.generation !== value.generation) return failure("TOURI-E9005", 409)
        if (["wake", "start"].includes(operation ?? "")) {
          if (value.state === "suspended" || value.state === "deleted") return failure("TOURI-E9004", 402)
          return success(job(value, "running", "waking"), 202)
        }
        if (operation === "park") return success(job(value, "hibernated", "parking"), 202)
        if (req.method === "DELETE" && !operation) {
          if (body.confirm !== true) return failure("TOURI-E9005", 409)
          return success(job(value, "deleted", "deleting"), 202)
        }
        if (operation === "snapshots") {
          const id = randomUUID()
          snapshots.set(id, { value: `persistent-workspace:${value.botId}`, accountId: device.accountId })
          return success({ path: `${baseUrl}/v1/snapshots/${id}` })
        }
        if (value.state !== "running") return failure("TOURI-E9005", 409)
        if (operation === "connections") {
          const origin = descriptorOrigin ?? baseUrl
          const ws = origin.replace(/^http/, "ws")
          const prefix = `${origin}/v1/machines/${value.id}`
          const channel = `${ws}/v1/machines/${value.id}`
          return success({
            protocolVersion: 1,
            generation: descriptorGeneration ?? value.generation,
            state: "running",
            expiresAt: iso(Date.now() + (descriptorExpired ? -1000 : 300_000)),
            transport: "gateway-wss",
            connection: {
              machineId: value.id,
              provider: "remote",
              endpoints: {
                browser: `${prefix}/gateway/9222`,
                bridge: `${channel}/runtime?generation=${value.generation}`,
              },
              ports: [],
              display: { name: ":99", width: 1440, height: 900 },
              bridge: {
                guestPort: 9876,
                socketPath: "/tmp/touri-mcp.sock",
                connectionFile: "/workspace/.touri/run/connection.sealed.json",
              },
              authKeyId: `generation-${value.generation}`,
            },
            channels: {
              runtime: `${channel}/runtime?generation=${value.generation}`,
              desktop: `${channel}/desktop?generation=${value.generation}`,
              pty: `${channel}/pty?generation=${value.generation}`,
              cdp: `${channel}/cdp?generation=${value.generation}`,
            },
            forwards: [
              { guestPort: 9222, path: `${prefix}/gateway/9222`, transport: "http" },
              { guestPort: 3000, path: `${prefix}/gateway/3000`, transport: "http" },
            ],
          } satisfies CloudConnection)
        }
        if (operation === "desktop-sessions") {
          if (body.control === true && !bots.get(value.botId)?.computerUse) return failure("TOURI-E9002", 403)
          const id = randomUUID()
          desktopSessions.set(id, {
            device,
            machineId: value.id,
            generation: value.generation,
            control: body.control === true,
            used: false,
            expires: now() + 15000,
          })
          return success({
            path: `${baseUrl.replace(/^http/, "ws")}/v1/machines/${value.id}/desktop-sessions/${id}?generation=${value.generation}`,
            password: "testVNC!",
          })
        }
        if (operation === "exec" || operation === "processes") {
          const env = body.env as Record<string, string> | undefined
          if (
            (env && Object.keys(env).some((key) => !["LANG", "TERM"].includes(key))) ||
            (typeof body.cwd === "string" && !body.cwd.startsWith("/workspace"))
          )
            return failure("TOURI-E9014", 403)
          if (operation === "exec") return success({ code: 0, stdout: "sandbox-linux\n", stderr: "" })
          const processId = String(body.processId)
          processRecords.set(processId, {
            device,
            machineId: value.id,
            generation: value.generation,
            command: String(body.command),
            stdin: "",
            canceled: false,
          })
          return success({
            path: `${baseUrl.replace(/^http/, "ws")}/v1/machines/${value.id}/processes/${processId}?generation=${value.generation}`,
          })
        }
        if (operation === "gateway") {
          if (Number(req.headers.get("Touri-Machine-Generation")) !== value.generation)
            return failure("TOURI-E9005", 409)
          if (parts[4] === "9222" && parts[5] === "json")
            return json({
              Browser: "Fake Chromium",
              webSocketDebuggerUrl: `${baseUrl.replace(/^http/, "ws")}/v1/machines/${value.id}/gateway/9222/devtools/browser/fake?generation=${value.generation}`,
            })
          return new Response("sandbox preview", {
            headers: { "Content-Type": "text/plain", "Touri-Cloud-Version": "1" },
          })
        }
      }
      if (parts[1] === "snapshots") {
        const value = snapshots.get(parts[2] ?? "")
        return value?.accountId === device.accountId
          ? new Response(value.value, { headers: { "Touri-Cloud-Version": "1" } })
          : failure("TOURI-E9003", 404)
      }
      if (parts[1] === "volumes") {
        if (req.method === "POST") {
          const name = randomUUID()
          volumes.set(name, device.accountId)
          return success({ name })
        }
        const name = parts[2] ?? ""
        if (volumes.get(name) !== device.accountId) return failure("TOURI-E9003", 404)
        volumes.delete(name)
        return success({ name })
      }
      return failure("TOURI-E9003", 404)
    },
    websocket: {
      open(socket) {
        sockets.add(socket)
        if (socket.data.kind === "events")
          for (const frame of events)
            if (frame.accountId === socket.data.device.accountId && Number(frame.cursor) > (socket.data.since ?? 0))
              socket.send(JSON.stringify({ ...frame, accountId: undefined }))
        if (socket.data.kind === "desktop") socket.send(Buffer.from("RFB 003.008\n"))
      },
      message(socket, bytes) {
        if (socket.data.device.revoked) return socket.close(1008)
        if (socket.data.machineId && machines.get(socket.data.machineId)?.generation !== socket.data.generation)
          return socket.close(1008)
        if (socket.data.kind === "process") {
          const process = processRecords.get(socket.data.processId ?? "")
          if (!process) return socket.close(1008)
          const frame = JSON.parse(String(bytes)) as { type: string; data?: string; signal?: string }
          if (frame.type === "stdin") process.stdin += Buffer.from(frame.data ?? "", "base64").toString()
          if (frame.type === "eof") {
            socket.send(
              JSON.stringify({
                type: "stdout",
                data: Buffer.from(process.stdin || "remote stdout").toString("base64"),
              }),
            )
            socket.send(JSON.stringify({ type: "stderr", data: Buffer.from("remote stderr").toString("base64") }))
            socket.send(JSON.stringify({ type: "exit", code: 0, signal: null }))
          }
          if (frame.type === "signal") {
            process.canceled = true
            socket.send(JSON.stringify({ type: "exit", code: null, signal: frame.signal }))
          }
        } else if (socket.data.kind === "cdp") {
          const frame = JSON.parse(String(bytes))
          socket.send(JSON.stringify({ id: frame.id, result: { product: "Fake Chromium" } }))
        } else if (socket.data.kind === "pty") socket.send(bytes)
        else if (socket.data.kind === "desktop") {
          const packet = Buffer.from(bytes as Uint8Array)
          const phase = socket.data.phase ?? 0
          if (phase === 0) {
            socket.data.phase = 1
            socket.send(Buffer.from([1, 2]))
          } else if (phase === 1) {
            socket.data.phase = 2
            socket.send(Buffer.alloc(16, 7))
          } else if (phase === 2) {
            socket.data.phase = 3
            socket.send(
              Buffer.from(packet.equals(vncResponse("testVNC!", Buffer.alloc(16, 7))) ? [0, 0, 0, 0] : [0, 0, 0, 1]),
            )
          }
        }
      },
      close(socket) {
        sockets.delete(socket)
      },
    },
  })
  const baseUrl: string = `http://127.0.0.1:${server.port}`
  return {
    baseUrl,
    calls,
    machines,
    bots,
    events,
    runs,
    transitions,
    processRecords,
    devices,
    advance(ms: number) {
      timeOffset += ms
    },
    approve(userCode: string, accountId = "account-a") {
      const pair = [...pairings.values()].find((pair) => pair.userCode === userCode)
      if (!pair) throw new Error("Unknown code")
      pair.approved = true
      pair.accountId = accountId
    },
    issueTokens(accountId = "account-a") {
      const device = { id: randomUUID(), accountId, revoked: false, refresh: "", used: new Set<string>() }
      devices.set(device.id, device)
      return tokens(device)
    },
    setProtocolVersion(value: string) {
      protocolVersion = value
    },
    setSandbox(value: boolean) {
      sandbox = value
    },
    setDescriptor(options: { origin?: string; generation?: number; expired?: boolean }) {
      descriptorOrigin = options.origin ?? null
      descriptorGeneration = options.generation ?? null
      descriptorExpired = options.expired ?? false
    },
    revoke(deviceId: string) {
      const device = devices.get(deviceId)
      if (device) revoke(device)
    },
    stop() {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.close()
      server.stop(true)
    },
  }
}
export type FakeCloud = ReturnType<typeof createFakeCloud>
