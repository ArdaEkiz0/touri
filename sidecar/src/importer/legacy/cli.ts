import { Database, constants as sqliteFlags } from "bun:sqlite"
import { existsSync } from "node:fs"
import type { Kernel, LegacyImportOptions, LegacySource, ServiceMap } from "@touri/contracts"
import { createKernel } from "../../kernel"
import { ensurePrivateDirectory, prepareDatabaseFile } from "../../kernel/files"
import { newId } from "../../kernel/ids"
import { createAppPaths } from "../../kernel/paths"
import { createShellEnv } from "../../kernel/shell-env"
import { spawnTree } from "../../kernel/spawn"
import { runLegacyImport } from "./import"

const valueAfter = ({ args, flag }: { args: Array<string>; flag: string }): string | null => {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  return value && !value.startsWith("--") ? value : null
}

const valuesAfter = ({ args, flag }: { args: Array<string>; flag: string }): Array<string> => {
  const values: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue
    const value = args[index + 1]
    if (value && !value.startsWith("--")) values.push(value)
    index += 1
  }
  return values
}

const parseSource = (args: Array<string>): LegacySource => {
  const kind = valueAfter({ args, flag: "--source" })
  const root = valueAfter({ args, flag: kind === "local" ? "--path" : "--root" })
  if (!kind || !root)
    throw new Error("Usage: --source local --path <dir> or --source ssh --host user@host --root <dir>")
  if (kind === "local") return { kind: "local", root }
  if (kind !== "ssh") throw new Error("--source must be local or ssh")
  const hostValue = valueAfter({ args, flag: "--host" })
  if (!hostValue) throw new Error("SSH source requires --host")
  const at = hostValue.lastIndexOf("@")
  if (at <= 0 || at === hostValue.length - 1) throw new Error("--host must be user@host")
  return { kind: "ssh", user: hostValue.slice(0, at), host: hostValue.slice(at + 1), root }
}

const parseMappings = (args: Array<string>): LegacyImportOptions["cwdMap"] => {
  const mappings: LegacyImportOptions["cwdMap"] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--cwd-map") continue
    const value = args[index + 1]
    if (!value) continue
    const separator = value.indexOf("=")
    if (separator > 0 && separator < value.length - 1)
      mappings.push({ from: value.slice(0, separator), to: value.slice(separator + 1) })
    index += 1
  }
  return mappings
}

const reportForCli = ({ report, perBot }: Awaited<ReturnType<typeof runLegacyImport>>): string =>
  JSON.stringify({ ...report, perBot }, null, 2)

const openExistingRuntime = (appData: string): { kernel: Kernel; stop: () => void } => {
  const paths = createAppPaths({ appData })
  for (const directory of [
    paths.appData,
    paths.runDir,
    paths.botsDir,
    paths.attachmentsDir,
    paths.sessionsDir,
    paths.importsDir,
    paths.logsDir,
  ])
    ensurePrivateDirectory({ root: paths.appData, path: directory })
  const databasePath = prepareDatabaseFile({ root: paths.appData, path: paths.db })
  const database = new Database(databasePath, sqliteFlags.SQLITE_OPEN_READWRITE | sqliteFlags.SQLITE_OPEN_NOFOLLOW)
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
  const services: Kernel["services"] = {
    provide: <K extends keyof ServiceMap>(_name: K, _implementation: ServiceMap[K]): void => undefined,
    use: <K extends keyof ServiceMap>(_name: K): ServiceMap[K] | null => null,
  }
  const processSpawn = (input: Parameters<Kernel["spawnTree"]>[0]) => spawnTree(input)
  const shell = createShellEnv({ spawn: processSpawn })
  const kernel: Kernel = {
    paths,
    services,
    spawnTree: processSpawn,
    db: database,
    publish: () => undefined,
    subscribe: () => () => undefined,
    registerRoutes: () => undefined,
    registerTools: ({ tools }) => ({ success: true, count: tools.length }),
    callHost: async () => ({ success: false, errorCode: "HOST_UNAVAILABLE", error: "CLI has no host bridge" }),
    onHostNotification: () => () => undefined,
    redact: (text) => text,
    addRedactionValue: () => undefined,
    shellEnv: shell.shellEnv,
    newId,
    log: () => undefined,
  }
  return { kernel, stop: () => database.close() }
}

/** Runs an import into `appData` (an existing database is opened in place) and returns the JSON report. */
export const runLegacyImportInto = async ({
  appData,
  options,
}: {
  appData: string
  options: LegacyImportOptions
}): Promise<string> => {
  const runtime = existsSync(createAppPaths({ appData }).db) ? openExistingRuntime(appData) : createKernel({ appData })
  try {
    const result = await runLegacyImport({ kernel: runtime.kernel, importId: runtime.kernel.newId(), options })
    return reportForCli(result)
  } finally {
    runtime.stop()
  }
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const appData = process.env.TOURI_APP_DATA ?? createAppPaths().appData
  const options: LegacyImportOptions = {
    source: parseSource(args),
    botIds: args.includes("--all") ? [] : valuesAfter({ args, flag: "--bot" }),
    importCodexSessions: args.includes("--import-codex-sessions"),
    cwdMap: parseMappings(args),
    includeAttachments: !args.includes("--no-attachments"),
    dryRun: args.includes("--dry-run"),
  }
  process.stdout.write(`${await runLegacyImportInto({ appData, options })}\n`)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (process.env.TOURI_DEBUG ? (error.stack ?? error.message) : error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
