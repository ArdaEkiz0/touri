/** Drain long-lived child output without retaining it in a Response.text() buffer. */
export const discardStream = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
  const reader = stream.getReader()
  try {
    while (!(await reader.read()).done) {}
  } catch {
    // Process teardown can close the pipe while a read is pending.
  } finally {
    reader.releaseLock()
  }
}
