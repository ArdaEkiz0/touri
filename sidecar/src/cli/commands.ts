import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { runLegacyImportInto } from "../importer/legacy/cli"
import { atomicWriteFile, ensurePrivateDirectory } from "../kernel/files"
import { createAppPaths } from "../kernel/paths"
import { runMcpStdio } from "../main"
import type { CliCommand } from "./args"
import { usageText } from "./args"
import { type AuthStore, openAuthStore } from "./auth/store"
import { runDoctor } from "./doctor"
import { authDbName, runServeCommand } from "./serve"
import { isProcessAlive, readServeInfo } from "./serveInfo"
import { cliVersion } from "./version"

export const clientConfigName = "client.json"

const out = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const fail = (message: string): number => {
  process.stderr.write(`${message}\n`)
  return 1
}

const withStore = async <T>(dataDir: string, use: (store: AuthStore) => Promise<T> | T): Promise<T> => {
  ensurePrivateDirectory({ root: dataDir })
  const store = openAuthStore({ filename: join(dataDir, authDbName) })
  try {
    return await use(store)
  } finally {
    store.close()
  }
}

const formatTime = (at: number | null): string => (at === null ? "never" : new Date(at).toISOString())

const printCode = ({ code, expiresAt }: { code: string; expiresAt: number }): void => {
  out(`Pairing code: ${code}`)
  out(`Valid until ${new Date(expiresAt).toISOString()} (single use). Enter it on the server's web page.`)
}

const saveClientConfig = ({ dataDir, url, token }: { dataDir: string; url: string; token: string }): void => {
  ensurePrivateDirectory({ root: dataDir })
  const path = join(dataDir, clientConfigName)
  atomicWriteFile({ root: dataDir, path, content: JSON.stringify({ url, token }) })
}

const claimRemote = async ({ url, code }: { url: string; code: string }): Promise<{ token: string } | string> => {
  const target = new URL("/pair", url)
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(target.hostname))
  )
    return "O pareamento remoto exige HTTPS. Use um proxy HTTPS confiável, como Tailscale Serve."
  const response = await fetch(target, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Origin: target.origin },
    body: JSON.stringify({ code, name: "touri CLI", client: true }),
  })
  const body = (await response.json()) as { token?: string; error?: string }
  if (!response.ok || !body.token) return body.error ?? `pairing failed (${response.status})`
  return { token: body.token }
}

const pairClient = async (command: Extract<CliCommand, { name: "pair" }>): Promise<number> => {
  const info = readServeInfo(command.dataDir)
  const url = command.url ?? info?.url ?? `http://127.0.0.1:${info?.port ?? command.port}`
  const code =
    command.code ??
    (await withStore(command.dataDir, (store) => {
      const created = store.createPairingCode()
      return created.code
    }))
  const claimed = await claimRemote({ url, code }).catch((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  )
  if (typeof claimed === "string") return fail(`Could not pair the CLI with ${url}: ${claimed}`)
  saveClientConfig({ dataDir: command.dataDir, url, token: claimed.token })
  out(command.printToken ? claimed.token : `CLI paired with ${url}`)
  return 0
}

const runPair = async (command: Extract<CliCommand, { name: "pair" }>): Promise<number> => {
  if (command.client) return pairClient(command)
  return withStore(command.dataDir, (store) => {
    printCode(store.createPairingCode())
    return 0
  })
}

const runDevices = async (command: Extract<CliCommand, { name: "devices" }>): Promise<number> =>
  withStore(command.dataDir, (store) => {
    if (command.revokeId !== null) {
      const revoked = store.revokeDevice(command.revokeId)
      if (!revoked.success) return fail(revoked.error)
      out(`Revoked ${revoked.device.id} (${revoked.device.name})`)
      return 0
    }
    const active = store.listDevices().filter((device) => device.revokedAt === null)
    if (active.length === 0) out("No paired devices")
    for (const device of active) out(`${device.id}  ${device.name}  last seen ${formatTime(device.lastSeenAt)}`)
    return 0
  })

const probe = async (url: string): Promise<boolean> =>
  fetch(new URL("/pair", url), { signal: AbortSignal.timeout(2000) })
    .then((response) => response.ok)
    .catch(() => false)

const runStatus = async (command: Extract<CliCommand, { name: "status" }>): Promise<number> => {
  const info = readServeInfo(command.dataDir)
  const alive = info !== null && isProcessAlive(info.pid)
  const local = alive ? `http://127.0.0.1:${info.port}` : null
  const reachable = local === null ? false : await probe(local)
  out(`touri ${cliVersion}`)
  out(`data dir: ${command.dataDir}`)
  out(`server: ${alive && reachable ? `running (pid ${info?.pid}, ${local})` : "not running"}`)
  if (info?.url) out(`tailscale url: ${info.url}`)
  if (!existsSync(join(command.dataDir, authDbName))) return alive && reachable ? 0 : 3
  await withStore(command.dataDir, (store) => {
    out(`paired devices: ${store.listDevices().filter((device) => device.revokedAt === null).length}`)
    out(`pending pairing codes: ${store.pendingCodeCount()}`)
  })
  return alive && reachable ? 0 : 3
}

const runImport = async (command: Extract<CliCommand, { name: "import-legacy" }>): Promise<number> => {
  if (!existsSync(command.path)) return fail(`Source directory not found: ${command.path}`)
  process.env.TOURI_APP_DATA = command.dataDir
  const report = await runLegacyImportInto({
    appData: createAppPaths({ appData: command.dataDir }).appData,
    options: {
      source: { kind: "local", root: command.path },
      botIds: [],
      importCodexSessions: command.importCodexSessions,
      cwdMap: [],
      includeAttachments: true,
      dryRun: command.dryRun,
    },
  })
  out(report)
  return 0
}

const runMcp = async (command: Extract<CliCommand, { name: "mcp-stdio" }>): Promise<number> => {
  await runMcpStdio({ threadId: command.threadId, appData: command.dataDir })
  return Number(process.exitCode ?? 0)
}

/** Executes a parsed command and returns the process exit code. `serve` resolves immediately and keeps running. */
export const runCommandLine = async (command: CliCommand): Promise<number> => {
  if (command.name === "help") {
    out(usageText)
    return 0
  }
  if (command.name === "version") {
    out(cliVersion)
    return 0
  }
  if (command.name === "serve") {
    await runServeCommand(command.options)
    return -1
  }
  if (command.name === "pair") return runPair(command)
  if (command.name === "devices") return runDevices(command)
  if (command.name === "status") return runStatus(command)
  if (command.name === "doctor") return runDoctor(command)
  if (command.name === "import-legacy") return runImport(command)
  return runMcp(command)
}

export const readClientConfig = (dataDir: string): { url: string; token: string } | null => {
  const path = join(dataDir, clientConfigName)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { url: string; token: string }
  } catch {
    return null
  }
}
