import type { Kernel, MachineConnection, Result } from "@touri/contracts"

export type VmProviderErrorCode =
  | import("@touri/contracts").CloudErrorCode
  | "TOOL_MISSING"
  | "MACHINE_SERVICE_UNAVAILABLE"
  | "MACHINE_SERVICE_START_FAILED"
  | "COMMAND_FAILED"
  | "INVALID_NAME"
  | "INVALID_CONFIG"
  | "NOT_FOUND"
  | "NOT_RUNNING"
  | "PORT_NOT_CONFIGURED"
  | "STATUS_FAILED"
  | "SNAPSHOT_FAILED"

export type VmResult<T> = Result<T, VmProviderErrorCode>

export type VmStatus = "missing" | "created" | "running" | "stopped" | "unknown"

export type VmRef = {
  id: string
  name: string
  provider: string
}

export type VmConnectionRef = VmRef & { connection: MachineConnection }

export type VmPortSpec = {
  guestPort: number
  hostPort: number
  hostIp?: string
  protocol?: "tcp" | "udp"
}

export type VmVolumeSpec = {
  type?: "bind" | "volume"
  source: string
  target: string
  readOnly?: boolean
}

export type VmCreateOptions = {
  signal?: AbortSignal
  name: string
  image: string
  entrypoint?: string
  args?: Array<string>
  cpus?: number
  memoryMb?: number
  cwd?: string
  env?: Record<string, string>
  ports?: Array<VmPortSpec>
  volumes?: Array<VmVolumeSpec>
  dns?: Array<string>
}

export type VmExecOptions = {
  signal?: AbortSignal
  user?: string
  id: string
  command: string
  args?: Array<string>
  cwd?: string
  env?: Record<string, string>
  detach?: boolean
}

export type VmExecResult = {
  code: number
  stdout: string
  stderr: string
}

export type VmPortForward = {
  url?: string
  guestPort: number
  hostPort: number
  hostIp: string
  protocol: "tcp" | "udp"
}

export type VmSnapshot = {
  id: string
  path: string
}

export type VmInspection = {
  memoryMb?: number
  image: string
  volumes: Array<VmVolumeSpec>
  dns: Array<string>
}

export interface VmProvider {
  readonly name: string
  sweepOrphans?(input: { protectedVolumes: Array<string> }): Promise<void>
  stopBuilder?(): Promise<void>
  startService(): Promise<VmResult<object>>
  create(options: VmCreateOptions): Promise<VmResult<VmConnectionRef>>
  start(input: { id: string; signal?: AbortSignal }): Promise<VmResult<VmConnectionRef>>
  connection(input: { id: string; authKeyId?: string }): Promise<VmResult<MachineConnection>>
  stop(input: { id: string }): Promise<VmResult<VmRef>>
  exec(options: VmExecOptions): Promise<VmResult<VmExecResult>>
  forwardPort(input: { id: string; guestPort: number; hostPort?: number }): Promise<VmResult<VmPortForward>>
  snapshot(input: { id: string; path: string }): Promise<VmResult<VmSnapshot>>
  destroy(input: { id: string }): Promise<VmResult<{ id: string }>>
  status(input: { id: string; signal?: AbortSignal }): Promise<VmResult<{ id: string; status: VmStatus }>>
  inspect(input: { id: string; signal?: AbortSignal }): Promise<VmResult<VmInspection>>
  migrateWorkspace(input: { id: string; path: string; signal?: AbortSignal }): Promise<VmResult<VmVolumeSpec>>
  spawn(options: VmExecOptions): ReturnType<Kernel["spawnTree"]>
  createVolume(input: { name: string; signal?: AbortSignal }): Promise<VmResult<{ name: string }>>
  deleteVolume(input: { name: string }): Promise<VmResult<{ name: string }>>
  ensureImage(input: { progress: (line: string) => void; signal?: AbortSignal }): Promise<void>
  doctor(): Promise<Array<import("@touri/contracts").DoctorCheck>>
}
