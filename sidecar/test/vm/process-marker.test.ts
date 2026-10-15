import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("B05 guest process markers refuse a precreated symlink", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-process-marker-"))
  try {
    const path = join(root, "marker")
    const target = join(root, "target")
    writeFileSync(target, "original")
    symlinkSync(target, path)
    const child = Bun.spawn(
      ["python3", "-c", (await import("../../src/vm/apple-container")).VM_PROCESS_COMMAND, path, "/usr/bin/true"],
      { stderr: "pipe" },
    )
    expect(await child.exited).not.toBe(0)
    expect(readFileSync(target, "utf8")).toBe("original")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("B05 process markers publish a complete private record and honor cancellation before exec", async () => {
  const { VM_PROCESS_COMMAND } = await import("../../src/vm/apple-container")
  const { existsSync, statSync } = await import("node:fs")
  for (const canceled of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "touri-process-launch-"))
    try {
      const path = join(root, "marker"),
        executed = join(root, "executed")
      if (canceled) writeFileSync(`${path}.cancel`, "")
      const child = Bun.spawn(["python3", "-c", VM_PROCESS_COMMAND, path, "/usr/bin/touch", executed], {
        stderr: "pipe",
      })
      expect(await child.exited).toBe(canceled ? 130 : 0)
      expect(existsSync(executed)).toBe(!canceled)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(Number.isSafeInteger(JSON.parse(readFileSync(path, "utf8")).pid)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
