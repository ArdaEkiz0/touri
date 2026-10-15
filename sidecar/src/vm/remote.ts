import { randomUUID } from "node:crypto"
import type { CloudConnection, CloudMachine, CloudOperation, Kernel } from "@touri/contracts"
import { type CloudClient, CloudError } from "../cloud/client"
import { httpGateway, tcpGateway } from "../cloud/gateway"
import { atomicDownload } from "./atomic-download"
import type { VmExecOptions, VmProvider, VmResult } from "./types"

export const validateCloudConnection = (client: CloudClient, value: CloudConnection, machine: CloudMachine) => {
  if (
    value?.protocolVersion !== 1 ||
    value.transport !== "gateway-wss" ||
    value.state !== "running" ||
    value.generation !== machine.generation ||
    Date.parse(value.expiresAt) <= Date.now() ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    value.connection?.machineId !== machine.id ||
    value.connection.provider !== "remote" ||
    !value.connection.authKeyId ||
    !Array.isArray(value.connection.ports) ||
    value.connection.ports.length !== 0 ||
    !value.channels ||
    !Array.isArray(value.forwards)
  )
    throw new CloudError("TOURI-E9007")
  const scoped = (path: string, ws = false) => {
    const url = new URL(client.endpoint(path, ws))
    if (!url.pathname.startsWith(`/v1/machines/${encodeURIComponent(machine.id)}/`)) throw new CloudError("TOURI-E9008")
    return url
  }
  scoped(value.connection.endpoints.browser)
  scoped(value.connection.endpoints.bridge, true)
  for (const path of Object.values(value.channels)) scoped(path, true)
  for (const forward of value.forwards) {
    scoped(forward.path)
    if (!Number.isInteger(forward.guestPort) || !["http", "ws"].includes(forward.transport))
      throw new CloudError("TOURI-E9007")
  }
  return value
}

export const createRemoteProvider = ({ client }: { client: CloudClient }) => {
  const connections = new Map<string, CloudConnection>()
  const proxies = new Map<string, { hostPort: number; url: string; close: () => void }>()
  const processes = new Set<WebSocket>()
  const expiry = new Map<string, ReturnType<typeof setTimeout>>()
  const result = async <T>(action: () => Promise<T>): Promise<VmResult<T>> => {
    try {
      return { success: true, ...(await action()) }
    } catch (error) {
      return {
        success: false,
        errorCode: error instanceof CloudError ? error.code : "TOURI-E9000",
        error: error instanceof CloudError ? error.message : "O serviço de nuvem está indisponível.",
      }
    }
  }
  const machine = (id: string, signal?: AbortSignal) =>
    client.request<CloudMachine>("GET", `/v1/machines/${encodeURIComponent(id)}`, undefined, signal)
  const wait = async (operation: CloudOperation, signal?: AbortSignal) => {
    const deadline = Date.now() + 180_000
    let current = operation
    let pollDelayMs = 250
    while (current.status === "pending") {
      if (signal?.aborted || Date.now() >= deadline) throw new CloudError("TOURI-E9000")
      await Bun.sleep(pollDelayMs)
      pollDelayMs = Math.min(2000, pollDelayMs * 2)
      current = await client.request<CloudOperation>(
        "GET",
        `/v1/operations/${encodeURIComponent(current.operationId)}`,
        undefined,
        signal,
      )
    }
    if (current.status !== "succeeded" || !current.machine) throw new CloudError(current.error?.code ?? "TOURI-E9000")
    return current.machine
  }
  const disconnect = (id?: string) => {
    for (const [machineId, timer] of expiry)
      if (!id || id === machineId) {
        clearTimeout(timer)
        expiry.delete(machineId)
      }
    for (const [key, proxy] of proxies)
      if (!id || key.startsWith(`${id}:`)) {
        proxy.close()
        proxies.delete(key)
      }
    if (id) connections.delete(id)
    else {
      connections.clear()
      for (const process of processes) process.close()
      processes.clear()
    }
  }
  const envelope = async (id: string) => {
    const state = await machine(id)
    const value = validateCloudConnection(
      client,
      await client.request<CloudConnection>("POST", `/v1/machines/${encodeURIComponent(id)}/connections`, {
        generation: state.generation,
      }),
      state,
    )
    const old = connections.get(id)
    if (old && old.generation !== value.generation) disconnect(id)
    connections.set(id, value)
    clearTimeout(expiry.get(id))
    const timer = setTimeout(() => disconnect(id), Date.parse(value.expiresAt) - Date.now())
    timer.unref()
    expiry.set(id, timer)
    return value
  }
  const lifecycle = async (id: string, action: string) => {
    const state = await machine(id)
    disconnect(id)
    return wait(
      await client.request<CloudOperation>("POST", `/v1/machines/${encodeURIComponent(id)}/${action}`, {
        generation: state.generation,
      }),
    )
  }
  const ref = (value: CloudMachine) => ({ id: value.id, name: value.botId, provider: "remote" })
  const requireCapability = async (capability: string) => {
    if (!(await client.capabilities()).capabilities.includes(capability as "exec")) throw new CloudError("TOURI-E9009")
  }
  const provider: VmProvider = {
    name: "remote",
    startService: () =>
      result(async () => {
        await client.capabilities()
        return {}
      }),
    create: (options) =>
      result(async () => {
        await client.capabilities()
        if (
          (options.env && Object.keys(options.env).length) ||
          options.volumes?.length ||
          options.ports?.length ||
          options.dns?.length ||
          options.entrypoint ||
          options.args?.length ||
          options.cwd ||
          options.cpus ||
          options.memoryMb
        )
          throw new CloudError("TOURI-E9014")
        const value = await wait(
          await client.request<CloudOperation>(
            "POST",
            "/v1/machines",
            { botId: options.name, size: "small", imageVersion: options.image },
            options.signal,
          ),
          options.signal,
        )
        return { ...ref(value), connection: (await envelope(value.id)).connection }
      }),
    start: ({ id }) =>
      result(async () => {
        const value = await lifecycle(id, "start")
        return { ...ref(value), connection: (await envelope(id)).connection }
      }),
    connection: ({ id }) => result(async () => (await envelope(id)).connection),
    stop: ({ id }) => result(async () => ref(await lifecycle(id, "park"))),
    destroy: ({ id }) =>
      result(async () => {
        const state = await machine(id)
        disconnect(id)
        await wait(
          await client.request<CloudOperation>("DELETE", `/v1/machines/${encodeURIComponent(id)}`, {
            generation: state.generation,
            confirm: true,
          }),
        )
        return { id }
      }),
    status: ({ id, signal }) =>
      result(async () => {
        const value = await machine(id, signal)
        return {
          id,
          status:
            value.state === "running"
              ? ("running" as const)
              : value.state === "deleted"
                ? ("missing" as const)
                : value.state === "provisioning"
                  ? ("created" as const)
                  : ("stopped" as const),
        }
      }),
    inspect: ({ id, signal }) =>
      result(async () => {
        const value = await machine(id, signal)
        return {
          image: value.imageVersion,
          volumes: [{ type: "volume" as const, source: value.volumeId, target: "/workspace" }],
          dns: [],
        }
      }),
    exec: (options) =>
      result(async () => {
        await requireCapability("exec")
        const value = await machine(options.id, options.signal)
        return client.request(
          "POST",
          `/v1/machines/${encodeURIComponent(options.id)}/exec`,
          {
            generation: value.generation,
            command: options.command,
            args: options.args ?? [],
            cwd: options.cwd ?? "/workspace",
            env: options.env ?? {},
          },
          options.signal,
        )
      }),
    forwardPort: ({ id, guestPort, hostPort }) =>
      result(async () => {
        if (hostPort) throw new CloudError("TOURI-E9009")
        const value = await envelope(id)
        const forward = value.forwards.find((item) => item.guestPort === guestPort)
        if (!forward) throw new CloudError("TOURI-E9002")
        const key = `${id}:${guestPort}`
        let proxy = proxies.get(key)
        if (!proxy) {
          proxy =
            forward.transport === "http"
              ? httpGateway(client, forward.path, value)
              : await tcpGateway(client, new URL(forward.path, value.channels.pty).toString().replace(/^http/, "ws"))
          proxies.set(key, proxy)
        }
        return { guestPort, url: proxy.url, hostPort: proxy.hostPort, hostIp: "127.0.0.1", protocol: "tcp" as const }
      }),
    snapshot: ({ id, path }) =>
      result(async () => {
        await requireCapability("snapshots")
        const value = await client.request<{ path: string }>(
          "POST",
          `/v1/machines/${encodeURIComponent(id)}/snapshots`,
          {},
        )
        const response = await fetch(client.endpoint(value.path), {
          redirect: "error",
          headers: { Authorization: `Bearer ${await client.access()}`, "Touri-Cloud-Version": "1" },
          signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new CloudError("TOURI-E9000")
        await atomicDownload(response, path)
        return { id, path }
      }),
    createVolume: ({ name }) =>
      result(async () => {
        await requireCapability("volumes")
        return client.request("POST", "/v1/volumes", { name })
      }),
    deleteVolume: ({ name }) =>
      result(async () => {
        await requireCapability("volumes")
        return client.request("DELETE", `/v1/volumes/${encodeURIComponent(name)}`, { confirm: true })
      }),
    // Importing host workspaces requires a separate, explicitly filtered export/handoff (C2).
    migrateWorkspace: () =>
      result(async () => {
        throw new CloudError("TOURI-E9009")
      }),
    ensureImage: async ({ progress }) => {
      const value = await client.capabilities()
      if (!value.imageVersions.length) throw new CloudError("TOURI-E9009")
      progress("Imagem de sandbox disponível no servidor.")
    },
    doctor: async () => {
      const health = await provider.startService()
      return [
        {
          id: "cloud",
          status: health.success ? ("pass" as const) : ("fail" as const),
          ok: health.success,
          label: "Nuvem · sandbox",
          detail: health.success ? "Protocolo v1 disponível." : health.error,
          fix: null,
        },
      ]
    },
    spawn(options: VmExecOptions): ReturnType<Kernel["spawnTree"]> {
      const remoteProcessId = randomUUID()
      let socket: WebSocket | undefined
      let out: ReadableStreamDefaultController<Uint8Array>
      let err: ReadableStreamDefaultController<Uint8Array>
      let resolveExit: (value: { code: number | null; signal: string | null }) => void = () => {}
      let ended = false
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        resolveExit = resolve
      })
      const stdout = new ReadableStream<Uint8Array>({
        start(controller) {
          out = controller
        },
      })
      const stderr = new ReadableStream<Uint8Array>({
        start(controller) {
          err = controller
        },
      })
      const finish = (code: number | null, signal: string | null) => {
        if (ended) return
        ended = true
        out.close()
        err.close()
        resolveExit({ code, signal })
        socket?.close()
        if (socket) processes.delete(socket)
      }
      const opened = (async () => {
        await requireCapability("processes")
        const value = await machine(options.id)
        const process = await client.request<{ path: string }>(
          "POST",
          `/v1/machines/${encodeURIComponent(options.id)}/processes`,
          {
            processId: remoteProcessId,
            generation: value.generation,
            command: options.command,
            args: options.args ?? [],
            cwd: options.cwd ?? "/workspace",
            env: options.env ?? {},
          },
        )
        socket = await client.socket(process.path)
        processes.add(socket)
        socket.addEventListener("message", ({ data }) => {
          try {
            const frame = JSON.parse(String(data)) as {
              type: string
              data: string
              code: number
              signal: string | null
            }
            if (ended) return
            if (frame.type === "exit") return finish(frame.code, frame.signal)
            if (
              (frame.type !== "stdout" && frame.type !== "stderr") ||
              typeof frame.data !== "string" ||
              frame.data.length > 90_000
            )
              throw new CloudError("TOURI-E9007")
            const controller = frame.type === "stdout" ? out : err
            if ((controller.desiredSize ?? 0) < -64) throw new CloudError("TOURI-E9006")
            controller.enqueue(Buffer.from(frame.data, "base64"))
          } catch {
            finish(1, null)
          }
        })
        socket.addEventListener("close", () => finish(1, null))
        socket.addEventListener("error", () => finish(1, null))
        await new Promise<void>((resolve, reject) => {
          socket?.addEventListener("open", () => resolve(), { once: true })
          socket?.addEventListener("error", () => reject(new CloudError("TOURI-E9000")), { once: true })
          socket?.addEventListener("close", () => reject(new CloudError("TOURI-E9001")), { once: true })
        })
        return socket
      })()
      void opened.catch(() => finish(1, null))
      const send = async (frame: unknown) => {
        const ws = await opened
        if (ended || ws.bufferedAmount > 1_048_576) throw new CloudError("TOURI-E9000")
        ws.send(JSON.stringify(frame))
      }
      return {
        success: true,
        target: "remote",
        remoteProcessId,
        pid: 0,
        pgid: 0,
        stdout,
        stderr,
        extra: [],
        exited,
        stdin: new WritableStream({
          async write(bytes) {
            if (bytes.length > 65_536) throw new CloudError("TOURI-E9006")
            await send({ type: "stdin", data: Buffer.from(bytes).toString("base64") })
          },
          close: () => send({ type: "eof" }),
        }),
        kill: (signal) => {
          void send({ type: "signal", signal }).catch(() => finish(1, signal))
        },
      }
    },
  }
  return Object.assign(provider, {
    client,
    machine,
    wait,
    lifecycle,
    disconnect,
    envelope,
    async openDesktop(id: string, control = false) {
      await requireCapability("desktop")
      await envelope(id)
      const value = await machine(id)
      const session = await client.request<{ path: string; password: string }>(
        "POST",
        `/v1/machines/${encodeURIComponent(id)}/desktop-sessions`,
        { generation: value.generation, control },
      )
      if (!/^[\x21-\x7e]{8}$/.test(session.password)) throw new CloudError("TOURI-E9007")
      client.redactSecret(session.password)
      const proxy = await tcpGateway(client, session.path)
      proxies.set(`${id}:desktop:${randomUUID()}`, proxy)
      return { hostPort: proxy.hostPort, password: session.password, url: proxy.url }
    },
  })
}
export type RemoteProvider = ReturnType<typeof createRemoteProvider>
