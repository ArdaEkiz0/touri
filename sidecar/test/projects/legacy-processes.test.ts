import type { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { applyUpgradeBaselines } from "../../src/kernel/upgradeBaselines"
import { createHarness } from "./harness"

const createProject = async (harness: Awaited<ReturnType<typeof createHarness>>): Promise<string> => {
  const response = await harness.request("/projects", {
    method: "POST",
    body: JSON.stringify({ path: harness.projectPath }),
    headers: { "Content-Type": "application/json" },
  })
  expect(response.status).toBe(201)

  return ((await response.json()) as { project: { id: string } }).project.id
}

const names = (result: Awaited<ReturnType<Awaited<ReturnType<typeof createHarness>>["tool"]>>): string[] => {
  if (!result.success) return []
  const processes = (result.structured as { processes: Array<{ spec: { name: string } }> }).processes

  return processes.map((item) => item.spec.name)
}

test("R11-REG-06 a user-defined process without an owner stays visible to the project's local bot", async () => {
  const harness = await createHarness()
  try {
    const projectId = await createProject(harness)
    const db = harness.runtime.kernel.db as Database
    await harness.tool("process_define", { name: "web", command: "sleep 30" }, projectId)
    db.query("UPDATE processes SET created_by = 'user'").run()
    db.query("DELETE FROM settings WHERE key LIKE 'process-owner:%'").run()
    expect(names(await harness.tool("process_list", {}, projectId))).toEqual(["web"])
  } finally {
    await harness.close()
  }
}, 30_000)

test("R11-REG-06 upgrade assigns an agent-defined local process to the project's only eligible bot", async () => {
  const harness = await createHarness()
  try {
    const projectId = await createProject(harness)
    const db = harness.runtime.kernel.db as Database
    await harness.tool("process_define", { name: "web", command: "sleep 30" }, projectId)
    db.query("UPDATE processes SET created_by = 'agent'").run()
    db.query("DELETE FROM settings WHERE key LIKE 'process-owner:%'").run()
    db.query("DELETE FROM schema_meta WHERE key = 'security_upgrade_baselines'").run()
    applyUpgradeBaselines({ database: db })
    const owner = db.query("SELECT value_json FROM settings WHERE key LIKE 'process-owner:%'").get() as {
      value_json: string
    } | null
    expect(JSON.parse(owner?.value_json ?? "null")).toEqual({ botId: "bot-test", machine: "local" })
    expect(names(await harness.tool("process_list", {}, projectId))).toEqual(["web"])
  } finally {
    await harness.close()
  }
}, 30_000)

test("R11-REG-06 upgrade leaves an ambiguous agent-defined process unowned", async () => {
  const harness = await createHarness()
  try {
    const projectId = await createProject(harness)
    const db = harness.runtime.kernel.db as Database
    await harness.tool("process_define", { name: "web", command: "sleep 30" }, projectId)
    db.query(
      "INSERT INTO bots(id,name,provider,machine,access,approvals,project_id,home_dir,created_at,updated_at) VALUES ('second','second','codex','local','full','never',?,?,1,1)",
    ).run(projectId, harness.projectPath)
    db.query("UPDATE processes SET created_by = 'agent'").run()
    db.query("DELETE FROM settings WHERE key LIKE 'process-owner:%'").run()
    db.query("DELETE FROM schema_meta WHERE key = 'security_upgrade_baselines'").run()
    applyUpgradeBaselines({ database: db })
    expect(db.query("SELECT 1 FROM settings WHERE key LIKE 'process-owner:%'").get()).toBeNull()
  } finally {
    await harness.close()
  }
}, 30_000)
