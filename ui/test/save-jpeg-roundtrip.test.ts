import { expect, test, vi } from "vitest"
import { saveBlob, saveFile } from "../src/saveFile"

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x80, 0x81, 0xfe, 0xff, 0xef, 0xbf, 0xbd, 0xff,
  0xd9,
])

const decode = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

test("saveFile hands the exact base64 of the route response to save_file", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} })
  const invoke = vi.fn(async (_command: string, _args: unknown) => ({ path: "/tmp/a.jpg" }))
  const base64 = btoa(String.fromCharCode(...JPEG))

  await saveFile({ name: "a.jpg", base64 }, invoke)

  const sent = invoke.mock.calls[0]?.[1] as { dataBase64: string }
  expect(Array.from(decode(sent.dataBase64))).toEqual(Array.from(JPEG))
  expect(sent.dataBase64.startsWith("data:")).toBe(false)
})

test("saveBlob encodes a binary JPEG blob without any text decoding", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} })
  const invoke = vi.fn(async (_command: string, _args: unknown) => ({ path: "/tmp/b.jpg" }))

  await saveBlob(new Blob([JPEG], { type: "image/jpeg" }), "b.jpg", invoke)

  const sent = invoke.mock.calls[0]?.[1] as { dataBase64: string }
  expect(Array.from(decode(sent.dataBase64))).toEqual(Array.from(JPEG))
})
