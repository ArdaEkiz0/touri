import { expect, test } from "bun:test"
import { VncAuthenticator, vncPasswordFile, vncResponse } from "../../src/vm/vnc-auth"

test("VNC password files match x11vnc -storepasswd without sending secrets in argv", () => {
  expect(vncPasswordFile("touri123").toString("hex")).toBe("d5329df2837038e8")
  expect(() => vncPasswordFile("short")).toThrow()
  expect(() => vncPasswordFile("touri123extra")).toThrow()
})

test("proxy authenticates fragmented RFB challenges before exposing the guest stream", () => {
  const writes: Buffer[] = []
  const auth = new VncAuthenticator("touri123", (bytes) => writes.push(bytes))
  const challenge = Buffer.from("00112233445566778899aabbccddeeff", "hex")
  const hello = Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 2]), challenge])
  for (const byte of hello) expect(auth.push(Buffer.from([byte]))).toHaveLength(0)
  expect(writes).toEqual([Buffer.from("RFB 003.008\n"), Buffer.from([2]), vncResponse("touri123", challenge)])
  expect(auth.authenticated).toBe(false)
  const init = Buffer.from([5, 160, 3, 132])
  expect(auth.push(Buffer.concat([Buffer.alloc(4), init]))).toEqual(init)
  expect(auth.authenticated).toBe(true)
})

test("proxy rejects None authentication, invalid versions and failed VNC passwords", () => {
  const auth = () => new VncAuthenticator("touri123", () => {})
  expect(() => auth().push(Buffer.from("RFB 003.003\n"))).toThrow()
  expect(() => auth().push(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]))).toThrow()
  const failed = auth()
  failed.push(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 2]), Buffer.alloc(16)]))
  expect(() => failed.push(Buffer.from([0, 0, 0, 1]))).toThrow()
  expect(failed.authenticated).toBe(false)
})
