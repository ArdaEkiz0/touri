import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { AppPaths, Kernel } from "@touri/contracts"
import {
  atomicAppendFile,
  atomicWriteFile,
  ensurePrivateDirectory,
  movePrivateFile,
  readPrivateFile,
  removePrivateFile,
} from "./files"
import { redactStructured } from "./redact"

const maxLogBytes = 10 * 1024 * 1024
const retainedGenerations = 5

const rotate = (root: string, filename: string): void => {
  for (let index = retainedGenerations; index >= 1; index -= 1) {
    const current = `${filename}.${index}`
    if (!existsSync(current)) continue
    if (index === retainedGenerations) removePrivateFile({ root, path: current })
    else movePrivateFile({ root, from: current, to: `${filename}.${index + 1}` })
  }
  if (existsSync(filename)) movePrivateFile({ root, from: filename, to: `${filename}.1` })
}

const prepareLogFile = ({ root, filename, bytes }: { root: string; filename: string; bytes: number }): void => {
  const size = readPrivateFile({ root, path: filename })?.byteLength ?? 0
  if (size + bytes > maxLogBytes) rotate(root, filename)
}

const encodedLogLine = (line: string): Uint8Array => {
  const encoded = Buffer.from(`${line}\n`, "utf8")
  if (encoded.byteLength <= maxLogBytes) return encoded
  const bounded = new TextDecoder().decode(encoded.subarray(0, maxLogBytes - 4))
  return Buffer.from(`${bounded}\n`, "utf8")
}

export const createLogger = ({
  paths,
  redact,
}: {
  paths: AppPaths
  redact: (text: string) => string
}): Kernel["log"] => {
  ensurePrivateDirectory({ root: paths.appData, path: paths.logsDir })
  const filename = join(paths.logsDir, "sidecar.log")
  for (const name of readdirSync(paths.logsDir)) {
    const generation = name.match(/^sidecar\.log\.(\d+)$/)?.[1]
    if (name === "sidecar.log" || (generation && Number(generation) <= retainedGenerations)) {
      const path = join(paths.logsDir, name)
      const content = readPrivateFile({ root: paths.appData, path })
      if (content) atomicWriteFile({ root: paths.appData, path, content })
    } else if (generation) removePrivateFile({ root: paths.appData, path: join(paths.logsDir, name) })
  }
  return (entry) => {
    const line = JSON.stringify(redactStructured({ at: Date.now(), ...entry }, redact))
    const encoded = encodedLogLine(line)
    prepareLogFile({ root: paths.appData, filename, bytes: encoded.byteLength })
    atomicAppendFile({ root: paths.appData, path: filename, content: encoded })
    if (entry.level === "error" || entry.level === "warn") process.stderr.write(`${line}\n`)
  }
}
