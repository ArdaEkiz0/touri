import { expect, test } from "bun:test"
import containerfile from "../../src/vm/image/Containerfile" with { type: "text" }

test("guest files copied from the private build context are made readable for the node user", () => {
  const copy = containerfile.indexOf("/usr/local/lib/touri/")
  const chmod = containerfile.indexOf("chmod 0644 /usr/local/lib/touri/*")
  expect(copy).toBeGreaterThan(-1)
  expect(chmod).toBeGreaterThan(copy)
  expect(containerfile).toMatch(/chmod 0755 [^\n]*init\.sh/)
})
