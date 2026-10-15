import { expect, spyOn, test } from "bun:test"
import { readLines } from "../../src/projects/supervisor"

test("subprocess teardown can release the reader before log draining finishes", async () => {
  const bytes = new TextEncoder().encode("ação\r\núltima linha")
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2))
      controller.enqueue(bytes.slice(2))
      controller.close()
    },
  })
  const reader = stream.getReader()
  const getReader = spyOn(stream, "getReader").mockReturnValue(reader)
  const releaseLock = spyOn(reader, "releaseLock").mockImplementation(() => {
    throw new TypeError("Reader has already been released")
  })
  const lines: Array<string> = []
  try {
    await readLines({ stream, onLine: (line) => lines.push(line) })
    expect(lines).toEqual(["ação", "última linha"])
    expect(releaseLock).toHaveBeenCalledTimes(1)
  } finally {
    releaseLock.mockRestore()
    getReader.mockRestore()
    reader.releaseLock()
  }
})

test("a log callback failure remains visible when teardown also releases the reader", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("line\n"))
      controller.close()
    },
  })
  const reader = stream.getReader()
  const getReader = spyOn(stream, "getReader").mockReturnValue(reader)
  const releaseLock = spyOn(reader, "releaseLock").mockImplementation(() => {
    throw new TypeError("Reader has already been released")
  })
  const failure = new Error("log callback failed")
  try {
    await expect(
      readLines({
        stream,
        onLine: () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
  } finally {
    releaseLock.mockRestore()
    getReader.mockRestore()
    reader.releaseLock()
  }
})
