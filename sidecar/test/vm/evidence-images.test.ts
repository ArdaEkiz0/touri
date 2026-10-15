import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Bot, Kernel, VmRuntime } from "@touri/contracts"
import {
  evidenceImageRoute,
  guestImage,
  imageMime,
  imagePath,
  localImage,
  MAX_IMAGE_BYTES,
} from "../../src/vm/evidence-images"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const root = () => {
  const path = mkdtempSync(join(tmpdir(), "touri-evidence-"))
  roots.push(path)
  return path
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
test("confines relative and absolute paths including encoded traversal, siblings and base directories", () => {
  expect(imagePath("/workspace", "/workspace/shots/a.png")).toBe("shots/a.png")
  expect(imagePath("/workspace", "./a.png", "reports")).toBe("reports/a.png")
  for (const path of ["../a.png", "shots/../a.png", "/etc/a.png", "/workspace-other/a.png", "a\\b.png", "bad\0.png"])
    expect(() => imagePath("/workspace", path)).toThrow()
  expect(() => imagePath("/workspace", "a.png", "../reports")).toThrow()
})
test("sniffs permitted raster signatures and refuses disguised HTML, SVG and truncated headers", () => {
  expect(imageMime(png)).toBe("image/png")
  expect(imageMime(Buffer.from([255, 216, 255, 0]))).toBe("image/jpeg")
  expect(imageMime(Buffer.from("GIF89a"))).toBe("image/gif")
  expect(imageMime(Buffer.from("RIFF0000WEBP"))).toBe("image/webp")
  for (const data of ["<html>fake.png", "<svg/>", "PNG", "RIFF"]) expect(imageMime(Buffer.from(data))).toBeNull()
})
test("streams from a pinned file and blocks leaf/ancestor links, nonfiles, MIME spoofing and oversized reads", async () => {
  const path = root()
  const outside = root()
  writeFileSync(join(path, "a.png"), png)
  writeFileSync(join(outside, "secret.png"), png)
  symlinkSync(join(outside, "secret.png"), join(path, "leaf.png"))
  symlinkSync(outside, join(path, "escape"))
  mkdirSync(join(path, "folder"))
  writeFileSync(join(path, "fake.png"), "<html>no</html>")
  writeFileSync(join(path, "big.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1))
  for (const name of ["leaf.png", "escape/secret.png", "folder", "fake.png", "big.png"])
    expect(() => localImage(path, name)).toThrow()
  const result = localImage(path, "a.png")
  rmSync(join(path, "a.png"))
  symlinkSync(join(outside, "secret.png"), join(path, "a.png"))
  expect(Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(png)
  const cancel = localImage(outside, "secret.png")
  await cancel.stream.cancel()
})
const fixture = (running = false) => {
  const path = root()
  const attachments = join(path, "attachments")
  mkdirSync(attachments)
  const db = new Database(":memory:")
  db.exec(
    "CREATE TABLE attachments(id TEXT, path TEXT, origin_path TEXT); CREATE TABLE projects(id TEXT, path TEXT, archived_at INTEGER); CREATE TABLE threads(id TEXT,bot_id TEXT); CREATE TABLE messages(thread_id TEXT,parts_json TEXT)",
  )
  const bot = { id: "bot", machine: "vm", homeDir: path, projectId: null, cwd: null, archivedAt: null } as Bot
  let acquired = 0
  let released = 0
  const calls: unknown[] = []
  const kernel = {
    db,
    paths: { attachmentsDir: attachments },
    services: { use: () => ({ getBot: () => bot }) },
  } as unknown as Kernel
  const vm = {
    states: () => [{ botId: "bot", status: running ? "running" : "stopped" }],
    acquire: async (input: unknown) => {
      acquired++
      calls.push(input)
      return async () => {
        released++
      }
    },
    exec: async (input: unknown) => {
      calls.push(input)
      return { success: true, stdout: JSON.stringify({ size: png.length, data: png.toString("base64") }) }
    },
  } as unknown as VmRuntime
  const route = evidenceImageRoute(kernel, vm)
  return {
    db,
    vm,
    path,
    attachments,
    calls,
    counts: () => ({ acquired, released }),
    request: (query: Record<string, string>) =>
      route.handler({ params: { id: "bot" }, query, body: {}, signal: new AbortController().signal }),
  }
}
test("stopped VM returns a typed unavailable state without any acquire/exec", async () => {
  const f = fixture()
  try {
    const result = await f.request({ path: "/workspace/a.png" })
    expect(result.status).toBe(409)
    expect("json" in result && result.json).toMatchObject({ errorCode: "IMAGE_MACHINE_STOPPED" })
    expect(f.calls).toHaveLength(0)
  } finally {
    f.db.close()
  }
})
test("running VM uses runningOnly and releases its lease after streaming/cancel", async () => {
  const f = fixture(true)
  try {
    const result = await f.request({ path: "/workspace/a.png" })
    expect(result.status).toBe(200)
    expect(f.calls[0]).toMatchObject({ runningOnly: true })
    expect("stream" in result && Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(png)
    expect(f.counts()).toEqual({ acquired: 1, released: 1 })
    const cancelled = await f.request({ path: "a.png" })
    if ("stream" in cancelled) await cancelled.stream.cancel()
    expect(f.counts().released).toBe(2)
  } finally {
    f.db.close()
  }
})
test("attachments read without VM wake and stored paths cannot escape the attachment root", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.attachments, "a.png"), png)
    writeFileSync(join(f.path, "secret.png"), png)
    f.db.query("INSERT INTO attachments VALUES (?,?,?)").run("good", join(f.attachments, "a.png"), "/upload/a.png")
    f.db.query("INSERT INTO attachments VALUES (?,?,?)").run("bad", join(f.path, "secret.png"), null)
    f.db.exec(
      `INSERT INTO threads VALUES ('thread','bot'); INSERT INTO messages VALUES ('thread','[{"type":"image","attachmentId":"good"},{"type":"image","attachmentId":"bad"}]')`,
    )
    const result = await f.request({ path: "/upload/a.png" })
    expect(result.status).toBe(200)
    if ("stream" in result) await result.stream.cancel()
    expect((await f.request({ attachmentId: "bad" })).status).toBe(422)
    expect(f.calls).toHaveLength(0)
  } finally {
    f.db.close()
  }
})

test("A07: attachment ID and origin-path lookup require a message belonging to the selected bot", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.attachments, "private.png"), png)
    f.db
      .query("INSERT INTO attachments VALUES (?,?,?)")
      .run("private", join(f.attachments, "private.png"), "/private.png")
    f.db.exec(
      `INSERT INTO threads VALUES ('victim','other-bot'); INSERT INTO messages VALUES ('victim','[{"type":"image","attachmentId":"private"}]')`,
    )
    for (const query of [{ attachmentId: "private" }, { path: "/private.png" }]) {
      const response = await f.request(query)
      if ("stream" in response) await response.stream.cancel()
      expect(response.status).toBe(404)
    }
  } finally {
    f.db.close()
  }
})

test("A07: shared source filenames still resolve the selected bot's own image", async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.attachments, "foreign.png"), png)
    writeFileSync(join(f.attachments, "own.png"), png)
    f.db.query("INSERT INTO attachments VALUES (?,?,?)").run("foreign", join(f.attachments, "foreign.png"), "/same.png")
    f.db.query("INSERT INTO attachments VALUES (?,?,?)").run("own", join(f.attachments, "own.png"), "/same.png")
    f.db.exec(`INSERT INTO threads VALUES ('other','other-bot'),('own','bot');
      INSERT INTO messages VALUES ('other','[{"type":"image","attachmentId":"foreign"}]'),('own','[{"type":"image","attachmentId":"own"}]')`)
    const response = await f.request({ path: "/same.png" })
    expect(response.status).toBe(200)
    if ("stream" in response) await response.stream.cancel()
  } finally {
    f.db.close()
  }
})
test("guest reader enforces symlink and traversal confinement and the size cap", () => {
  const path = root()
  const outside = root()
  writeFileSync(join(path, "a.png"), png)
  writeFileSync(join(outside, "a.png"), png)
  symlinkSync(outside, join(path, "escape"))
  symlinkSync(join(outside, "a.png"), join(path, "link.png"))
  writeFileSync(join(path, "big.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1))
  const script = guestImage.replace("'/workspace'", JSON.stringify(path))
  for (const name of ["../a.png", "escape/a.png", "link.png", "big.png"])
    expect(Bun.spawnSync(["python3", "-c", script, name, "0"]).exitCode).not.toBe(0)
  const good = Bun.spawnSync(["python3", "-c", script, "a.png", "0"])
  expect(good.exitCode).toBe(0)
  expect(JSON.parse(good.stdout.toString()).data).toBe(png.toString("base64"))
})

test("VM images larger than the exec limit stream in bounded blocks and release on failure", async () => {
  const f = fixture(true)
  const bytes = Buffer.alloc(2 * 1024 * 1024)
  png.copy(bytes)
  const offsets: number[] = []
  f.vm.exec = async (input) => {
    const offset = Number(input.args?.[3])
    offsets.push(offset)
    return {
      success: true,
      stdout: JSON.stringify({ size: bytes.length, data: bytes.subarray(offset, offset + 393216).toString("base64") }),
      stderr: "",
      code: 0,
    }
  }
  try {
    const result = await f.request({ path: "large.png" })
    expect("stream" in result && Buffer.from(await new Response(result.stream).arrayBuffer())).toEqual(bytes)
    expect(offsets).toEqual([0, 393216, 786432, 1179648, 1572864, 1966080])
    expect(f.counts().released).toBe(1)
    f.vm.exec = async () => ({ success: false, error: "No image", errorCode: "VM_ERROR" })
    expect((await f.request({ path: "large.png" })).status).toBe(422)
    expect(f.counts().released).toBe(2)
  } finally {
    f.db.close()
  }
})
