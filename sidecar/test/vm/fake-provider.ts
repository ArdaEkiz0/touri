import type { Kernel } from "@touri/contracts"
import { machineConnection } from "../../src/vm/connection"
import type { VmCreateOptions, VmExecOptions, VmProvider, VmStatus } from "../../src/vm/types"

export const fakeVmProvider = () => {
  const calls: Array<{ action: string; input: unknown }> = []
  const machines = new Map<string, VmStatus>()
  const configs = new Map<string, VmCreateOptions>()
  const files = new Map<string, string>()
  const volumes = new Set<string>()
  let failStart = false
  const keyIds = new Map<string, string>()
  const mappings = new Map<string, Map<number, number>>()
  const connection = (id: string) =>
    machineConnection({
      id,
      provider: "fake",
      authKeyId: keyIds.get(id) ?? null,
      ports: [...new Set([9876, 9222, ...(mappings.get(id)?.keys() ?? [])])].map((guestPort) => ({
        guestPort,
        hostPort: mappings.get(id)?.get(guestPort) ?? 49123,
        hostIp: "127.0.0.1",
        protocol: "tcp",
      })),
    })
  const provider: VmProvider = {
    name: "fake",
    startService: async () => ({ success: true }),
    create: async (input: VmCreateOptions) => {
      calls.push({ action: "create", input })
      machines.set(input.name, "created")
      configs.set(input.name, input)
      return { success: true, id: input.name, name: input.name, provider: "fake", connection: connection(input.name) }
    },
    start: async ({ id }) => {
      calls.push({ action: "start", input: id })
      if (failStart) return { success: false, errorCode: "COMMAND_FAILED", error: "start failed" }
      machines.set(id, "running")
      return { success: true, id, name: id, provider: "fake", connection: connection(id) }
    },
    connection: async ({ id, authKeyId }) => {
      if (authKeyId) keyIds.set(id, authKeyId)
      return { success: true, ...connection(id) }
    },
    stop: async ({ id }) => {
      calls.push({ action: "stop", input: id })
      machines.set(id, "stopped")
      return { success: true, id, name: id, provider: "fake" }
    },
    destroy: async ({ id }) => {
      calls.push({ action: "destroy", input: id })
      machines.delete(id)
      configs.delete(id)
      keyIds.delete(id)
      mappings.delete(id)
      return { success: true, id }
    },
    status: async ({ id }) => ({ success: true, id, status: machines.get(id) ?? "missing" }),
    inspect: async ({ id }) => {
      calls.push({ action: "inspect", input: id })
      const config = configs.get(id)
      if (!config) return { success: false, errorCode: "NOT_FOUND", error: "VM missing" }
      return {
        success: true,
        image: config.image,
        volumes: config.volumes ?? [],
        dns: config.dns ?? [],
        ...(config.memoryMb !== undefined ? { memoryMb: config.memoryMb } : {}),
      }
    },
    migrateWorkspace: async ({ id, path }) => {
      calls.push({ action: "migrateWorkspace", input: { id, path } })
      return { success: true, type: "bind", source: path, target: "/workspace" }
    },
    exec: async (input: VmExecOptions) => {
      calls.push({ action: "exec", input })
      if (input.command === "rm") for (const path of input.args ?? []) files.delete(path)
      return { success: true, code: 0, stdout: "", stderr: "" }
    },
    forwardPort: async (input) => {
      calls.push({ action: "forward", input })
      const ports = mappings.get(input.id) ?? new Map<number, number>()
      const hostPort = input.hostPort ?? ports.get(input.guestPort) ?? 49123
      ports.set(input.guestPort, hostPort)
      mappings.set(input.id, ports)
      return { success: true, guestPort: input.guestPort, hostPort, hostIp: "127.0.0.1", protocol: "tcp" }
    },
    createVolume: async ({ name }) => {
      calls.push({ action: "createVolume", input: name })
      volumes.add(name)
      return { success: true, name }
    },
    deleteVolume: async ({ name }) => {
      calls.push({ action: "deleteVolume", input: name })
      volumes.delete(name)
      files.clear()
      return { success: true, name }
    },
    snapshot: async ({ id, path }) => ({ success: true, id, path }),
    ensureImage: async ({ progress }) => {
      calls.push({ action: "image", input: null })
      progress("image progress")
    },
    doctor: async () => [],
    spawn(input): ReturnType<Kernel["spawnTree"]> {
      calls.push({ action: "spawn", input })
      let content = ""
      let resolve: (value: { code: number; signal: null }) => void = () => {}
      const exited = new Promise<{ code: number; signal: null }>((done) => {
        resolve = done
      })
      const empty = () => new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
      return {
        success: true,
        pid: 98765,
        pgid: 98765,
        stdout: empty(),
        stderr: empty(),
        extra: [],
        stdin: new WritableStream({
          write: (chunk) => {
            content += new TextDecoder().decode(chunk)
          },
          close: () => {
            const path = input.args?.at(-1) ?? ""
            files.set(path, content)
            resolve({ code: 0, signal: null })
          },
        }),
        exited,
        kill: () => resolve({ code: 0, signal: null }),
      }
    },
  }
  return {
    provider,
    calls,
    machines,
    configs,
    files,
    volumes,
    failStart: () => {
      failStart = true
    },
  }
}
