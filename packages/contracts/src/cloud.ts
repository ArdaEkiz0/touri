import type { Bot, MachineConnection, MachineState, Message, Run, SendMessageInput, UiEvent } from "./types"

export const CLOUD_PROTOCOL_VERSION = 1 as const
export type CloudErrorCode =
  | "TOURI-E9000"
  | "TOURI-E9001"
  | "TOURI-E9002"
  | "TOURI-E9003"
  | "TOURI-E9004"
  | "TOURI-E9005"
  | "TOURI-E9006"
  | "TOURI-E9007"
  | "TOURI-E9008"
  | "TOURI-E9009"
  | "TOURI-E9010"
  | "TOURI-E9011"
  | "TOURI-E9012"
  | "TOURI-E9013"
  | "TOURI-E9014"
export type CloudState =
  | "absent"
  | "provisioning"
  | "running"
  | "parking"
  | "hibernated"
  | "waking"
  | "suspended"
  | "error"
  | "deleting"
  | "deleted"
export type CloudTokens = { deviceId: string; accessToken: string; refreshToken: string; expiresAt: string }
export type CloudPairing = { userCode: string; verificationUri: string; expiresAt: string; intervalSeconds: number }
export type CloudAuthorization = CloudPairing & { deviceCode: string }
export type CloudAccount = {
  email?: string | null
  id: string
  name: string
  role: "owner" | "admin" | "member"
  deviceId: string
}
export type CloudPlan = {
  name: string
  priceCentavos: number
  currency: "BRL"
  status: "pending" | "active" | "past_due" | "suspended" | "canceled"
  includedSeconds: number
  storageBytes: number
  subscribeUrl: string
  sandbox: true
  access?: CloudPlan["status"]
}
export type CloudUsage = {
  usedSeconds: number
  includedSeconds: number
  storageBytes: number
  storageLimitBytes: number
  updatedAt: string
}
export type CloudAccountState = {
  enabled: boolean
  connected: boolean
  account: CloudAccount | null
  plan: CloudPlan | null
  usage: CloudUsage | null
  runtimeAvailable?: boolean
  pairing: CloudPairing | null
}
export type CloudCapabilities = {
  implementation?: { headlessRuntimeReady?: boolean; gatewayReady?: boolean }
  protocolVersion: 1
  sandbox: true
  runtime: "whole-bot"
  auth: "byok-api"
  imageVersions: string[]
  capabilities: Array<
    "exec" | "processes" | "snapshots" | "volumes" | "workspace-import" | "desktop" | "pty" | "cdp" | "preview"
  >
}
export type CloudMachine = {
  id: string
  botId: string
  generation: number
  state: CloudState
  imageVersion: string
  volumeId: string
  progress: string | null
  usage: CloudUsage
}
export type CloudOperation = {
  operationId: string
  status: "pending" | "succeeded" | "failed"
  machine: CloudMachine | null
  error?: { code: CloudErrorCode }
}
export type CloudConnection = {
  protocolVersion: 1
  generation: number
  state: "running"
  expiresAt: string
  transport: "gateway-wss"
  connection: MachineConnection
  channels: { runtime: string; desktop: string; pty: string; cdp: string }
  forwards: Array<{ guestPort: number; path: string; transport: "http" | "ws" }>
}
export type CloudEvent =
  | { cursor: string; botId: string; generation: number; event: UiEvent }
  | { resync: true; cursor: string }
export type CloudService = {
  uploadReport: (zip: Uint8Array<ArrayBuffer>, id: string) => Promise<{ id: string }>
  state: () => Promise<CloudAccountState>
  connected: () => Promise<boolean>
  createBot: (bot: Bot, apiKey?: string) => Promise<void>
  request: <T>(method: string, path: string, body?: unknown, signal?: AbortSignal) => Promise<T>
  send: (input: SendMessageInput) => Promise<{ message: Message; run: Run }>
  machine: (botId: string) => Promise<MachineState>
  park: (botId: string) => Promise<MachineState>
  wake: (botId: string) => Promise<MachineState>
}
