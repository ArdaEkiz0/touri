import { expect, test } from "bun:test"
import type { VmCommandRunner } from "../../src/vm/command"
import { createContainerMaintenance } from "../../src/vm/maintenance"

const ok = { code: 0, stdout: "", stderr: "" }
const bot = `touri-${"a".repeat(10)}-${"b".repeat(20)}`
const entry = (id: string, volumes: Array<string> = []) => ({
  configuration: {
    id,
    mounts: volumes.map((name) => ({ type: { volume: { name } } })),
  },
  status: "running",
})
const fixture = (containers = [entry("touri-migrate-old"), entry("touri-upgrade-test-old"), entry(bot)]) => {
  const calls: string[][] = []
  const warnings: string[] = []
  const run: VmCommandRunner = async (args) => {
    calls.push(args)
    if (args[0] === "list") return { ...ok, stdout: JSON.stringify(containers) }
    if (args[0] === "volume" && args[1] === "list")
      return {
        ...ok,
        stdout: JSON.stringify(
          [
            "touri-migrate-old-data",
            "touri-upgrade-test-old-data",
            "touri-migrate-volume-only-data",
            `${bot}-data`,
            "unrelated",
          ].map((name) => ({ configuration: { name } })),
        ),
      }
    return ok
  }
  return { calls, warnings, run, maintenance: createContainerMaintenance({ run, warn: (code) => warnings.push(code) }) }
}

test("orphan sweep stops/deletes only helper containers and unreferenced helper data volumes", async () => {
  const f = fixture([entry("touri-migrate-old"), entry("touri-upgrade-test-old"), entry(bot), entry("other")])
  await f.maintenance.sweepOrphans()
  expect(f.calls.filter((args) => args[0] === "stop")).toEqual([
    ["stop", "--time", "5", "touri-migrate-old"],
    ["stop", "--time", "5", "touri-upgrade-test-old"],
  ])
  expect(f.calls.filter((args) => args[0] === "delete")).toHaveLength(2)
  expect(f.calls.filter((args) => args[0] === "volume" && args[1] === "delete")).toHaveLength(3)
  expect(f.calls.filter((args) => ["stop", "delete"].includes(args[0] ?? "")).flat()).not.toContain(bot)
  expect(f.warnings).toEqual([])
})

test("sweep preserves migrated bot data, including mounts on stopped bots and pending metadata", async () => {
  const f = fixture([entry("touri-migrate-old"), { ...entry(bot, ["touri-migrate-old-data"]), status: "stopped" }])
  f.maintenance.retainVolume("touri-upgrade-test-old-data")
  await f.maintenance.sweepOrphans(["touri-migrate-volume-only-data"])
  expect(f.calls.some((args) => args[0] === "delete")).toBe(true)
  expect(f.calls.some((args) => args[0] === "volume" && args[1] === "delete")).toBe(false)
})

test("sweep skips all inventory and deletion while a migration is in flight", async () => {
  const f = fixture()
  await f.maintenance.withMigration(async () => {
    await f.maintenance.sweepOrphans()
    expect(f.calls).toEqual([])
  })
  await f.maintenance.sweepOrphans()
  expect(f.calls.length).toBeGreaterThan(0)
})

test("migration waits for an already started sweep and concurrent sweeps coalesce", async () => {
  let resolve = () => {}
  const wait = new Promise<void>((done) => {
    resolve = done
  })
  const f = fixture()
  const maintenance = createContainerMaintenance({
    run: async (args) => {
      if (args[0] === "list") await wait
      return f.run(args)
    },
  })
  const sweep = maintenance.sweepOrphans()
  expect(maintenance.sweepOrphans()).toBe(sweep)
  let migrated = false
  const migration = maintenance.withMigration(async () => {
    migrated = true
  })
  expect(migrated).toBe(false)
  resolve()
  await sweep
  await migration
  expect(migrated).toBe(true)
})

test.each(["stop failure", "timeout", "throw"])(
  "helper force deletion runs after %s and retries once",
  async (mode) => {
    const calls: string[][] = []
    const maintenance = createContainerMaintenance({
      timeoutMs: 5,
      run: async (args) => {
        calls.push(args)
        if (args[0] === "stop") {
          if (mode === "timeout") return new Promise(() => {})
          if (mode === "throw") throw new Error("stop failed")
          return { ...ok, code: 1 }
        }
        return { ...ok, code: calls.filter((args) => args[0] === "delete").length === 1 ? 1 : 0 }
      },
    })
    expect(await maintenance.destroyHelper("touri-migrate-stuck")).toBe(true)
    expect(calls).toEqual([
      ["stop", "--time", "5", "touri-migrate-stuck"],
      ["delete", "--force", "touri-migrate-stuck"],
      ["stop", "--time", "5", "touri-migrate-stuck"],
      ["delete", "--force", "touri-migrate-stuck"],
    ])
  },
)

test("failed helper deletion emits a coded warning and preserves its data volume", async () => {
  const f = fixture([entry("touri-migrate-old")])
  const maintenance = createContainerMaintenance({
    run: async (args) => (args[0] === "delete" ? { ...ok, code: 1, stderr: "busy" } : f.run(args)),
    warn: (code) => f.warnings.push(code),
  })
  await maintenance.sweepOrphans()
  expect(f.warnings).toEqual(["VM_HELPER_CLEANUP_FAILED"])
  expect(f.calls).not.toContainEqual(["volume", "delete", "touri-migrate-old-data"])
})

test.each(["invalid json", "{}", '[{"configuration":{"id":"bot"}}]'])(
  "sweep refuses ambiguous inventory: %s",
  async (stdout) => {
    const calls: string[][] = []
    const warnings: string[] = []
    const maintenance = createContainerMaintenance({
      run: async (args) => {
        calls.push(args)
        return { ...ok, stdout }
      },
      warn: (code) => warnings.push(code),
    })
    await maintenance.sweepOrphans()
    expect(calls.every((args) => args[0] === "list" || args[0] === "inspect")).toBe(true)
    expect(warnings).toEqual(["VM_ORPHAN_SWEEP_FAILED"])
  },
)

test("helper cleanup rejects a bot VM even when explicitly passed", async () => {
  const f = fixture()
  await expect(f.maintenance.destroyHelper(bot)).rejects.toThrow("restrita a helpers")
  expect(f.calls).toEqual([])
})

test.each(["error", "timeout"])("builder stop %s is bounded and logs a coded warning", async (mode) => {
  const warnings: string[] = []
  const maintenance = createContainerMaintenance({
    timeoutMs: 5,
    run: async (args) => {
      expect(args).toEqual(["builder", "stop"])
      if (mode === "timeout") return new Promise(() => {})
      return { ...ok, code: 1, stderr: "builder unavailable" }
    },
    warn: (code) => warnings.push(code),
  })
  await maintenance.stopBuilder()
  expect(warnings).toEqual(["VM_BUILDER_STOP_FAILED"])
})
