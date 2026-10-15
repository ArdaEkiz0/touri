export class BodyError extends Error {
  constructor(readonly status: number) {
    super("Corpo da solicitação inválido ou acima do limite")
  }
}

/** Count bytes before decoding; cancel slow and oversized bodies without buffering them. */
export const readJsonBody = async (
  request: Request,
  { maxBytes = 64 * 1024, deadlineMs = 5000 } = {},
): Promise<Record<string, unknown> | null> => {
  const length = request.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new BodyError(413)
  const reader = request.body?.getReader()
  if (!reader) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      void reader.cancel().catch(() => {})
      reject(new BodyError(408))
    }, deadlineMs)
  })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (expired) throw new BodyError(408)
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new BodyError(413)
      chunks.push(value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks, size).toString("utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch (error) {
    void reader.cancel().catch(() => {})
    if (error instanceof BodyError) throw error
    return null
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
