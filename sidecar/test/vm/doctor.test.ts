import { expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { vmDoctor } from "../../src/vm/doctor"

const capability = { available: true, reason: null, provider: "fake" }
const bot = `touri-${"a".repeat(10)}-${"b".repeat(20)}`
const entry = (id: string, state: string, memoryMb: number) => ({
  configuration: { id, resources: { memoryInBytes: memoryMb * 1024 ** 2 }, mounts: [] },
  status: { state },
})

test("Doctor reports per-VM configured memory and flags running helpers and builder using fakes", async () => {
  const calls: string[][] = []
  const checks = await vmDoctor(
    async (args) => {
      calls.push(args)
      const stdout =
        args[0] === "list"
          ? JSON.stringify([
              entry(bot, "running", 1536),
              entry("touri-migrate-leaked", "running", 512),
              entry("touri-upgrade-test-leaked", "running", 1024),
              entry("touri-other-helper", "running", 256),
              entry("touri-migrate-stopped", "stopped", 512),
              entry("buildkit", "running", 2048),
              entry("unrelated", "running", 128),
            ])
          : "container CLI version 1.5.0"
      return { code: 0, stdout, stderr: "" }
    },
    tmpdir(),
    capability,
  )
  expect(checks.find((check) => check.id === `vm-memory:${bot}`)?.detail).toContain("1536 MiB")
  expect(checks.find((check) => check.id === "vm-memory:buildkit")?.detail).toContain("2048 MiB")
  expect(checks.find((check) => check.id === "vm-orphans")).toMatchObject({ ok: false, status: "warn" })
  const orphans = checks.find((check) => check.id === "vm-orphans")?.detail ?? ""
  expect(orphans).toContain("touri-migrate-leaked")
  expect(orphans).toContain("touri-upgrade-test-leaked")
  expect(orphans).toContain("touri-other-helper")
  expect(orphans).not.toContain(bot)
  expect(orphans).not.toContain("touri-migrate-stopped")
  expect(orphans).not.toContain("unrelated")
  expect(checks.find((check) => check.id === "vm-builder")).toMatchObject({
    ok: false,
    status: "warn",
    fix: "container builder stop",
  })
  expect(calls).toContainEqual(["list", "--all", "--format", "json"])
  expect(calls.every((args) => !["stop", "delete", "builder"].includes(args[0] ?? ""))).toBe(true)
})

test.each(["[]", "invalid json"])("Doctor handles empty or invalid inventory: %s", async (stdout) => {
  const checks = await vmDoctor(async () => ({ code: 0, stdout, stderr: "" }), tmpdir(), capability)
  if (stdout === "[]") {
    expect(checks.find((check) => check.id === "vm-orphans")?.ok).toBe(true)
    expect(checks.find((check) => check.id === "vm-builder")?.ok).toBe(true)
  } else expect(checks.find((check) => check.id === "vm-inventory")).toMatchObject({ ok: false, status: "warn" })
})

test("Doctor reports missing memory without inventing a cap and does not flag stopped helpers", async () => {
  const stdout = JSON.stringify([{ configuration: { id: "touri-migrate-stopped" }, status: "stopped" }])
  const checks = await vmDoctor(async () => ({ code: 0, stdout, stderr: "" }), tmpdir(), capability)
  expect(checks.find((check) => check.id === "vm-memory:touri-migrate-stopped")).toMatchObject({
    ok: false,
    status: "warn",
  })
  expect(checks.find((check) => check.id === "vm-orphans")?.ok).toBe(true)
})

test("Doctor turns a container service failure into an inventory warning", async () => {
  const checks = await vmDoctor(async () => ({ code: 1, stdout: "", stderr: "XPC timeout" }), tmpdir(), capability)
  expect(checks.find((check) => check.id === "vm-inventory")).toMatchObject({ ok: false, status: "warn" })
})
