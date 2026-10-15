import { expect, test } from "bun:test"
import { newId } from "../../src/kernel/ids"

test("newId returns sortable Crockford ULIDs with random tails", () => {
  const ids = Array.from({ length: 2000 }, () => newId())
  for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  expect([...ids].sort()).toEqual(ids)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids.some((id) => !id.endsWith("000000"))).toBe(true)
})
