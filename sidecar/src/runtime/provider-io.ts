import type { Kernel } from "@touri/contracts"

export type ChildProcess = Extract<ReturnType<Kernel["spawnTree"]>, { success: true }>

/** Observe diagnostics as they arrive, including writes split across chunks. */
export const readProviderStderr = async (stream: ReadableStream<Uint8Array>, observe: (text: string) => void) => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    while (true) {
      const chunk = await reader.read()
      text = (text + decoder.decode(chunk.value, { stream: !chunk.done })).slice(-65_536)
      observe(text)
      if (chunk.done) return text
    }
  } finally {
    reader.releaseLock()
  }
}

const pendingWrites = new WeakMap<WritableStream<Uint8Array>, Promise<void>>()

/** Writes one JSON line; concurrent writers to the same stdin are queued, never rejected as locked. */
export const writeLine = ({ stdin, value }: { stdin: WritableStream<Uint8Array>; value: unknown }): Promise<void> => {
  const write = async () => {
    const writer = stdin.getWriter()
    try {
      await writer.write(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
    } finally {
      writer.releaseLock()
    }
  }
  const next = (pendingWrites.get(stdin) ?? Promise.resolve()).catch(() => undefined).then(write)
  pendingWrites.set(stdin, next)
  return next
}

export const startLineReader = ({
  stream,
  onLine,
  onError,
}: {
  stream: ReadableStream<Uint8Array>
  onLine: (line: string) => void
  onError: (error: Error) => void
}): (() => void) => {
  let stopped = false
  void (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!stopped) {
        const result = await reader.read()
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line) onLine(line)
          newline = buffer.indexOf("\n")
        }
      }
      const tail = buffer.trim()
      if (!stopped && tail) onLine(tail)
    } catch (error) {
      if (!stopped) onError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      reader.releaseLock()
    }
  })()
  return () => {
    stopped = true
  }
}
