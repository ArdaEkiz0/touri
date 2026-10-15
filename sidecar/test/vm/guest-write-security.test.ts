import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GUEST_WRITE_COMMAND } from "../../src/vm/guest-write"

const run = async (root: string, path: string, code = GUEST_WRITE_COMMAND) => {
  const child = Bun.spawn(["python3", "-c", code, root, path], { stdin: "pipe", stderr: "pipe", stdout: "pipe" })
  child.stdin.write("new content")
  child.stdin.end()
  return child.exited
}
test("B05 pinned guest writer refuses traversal, symlink leaf, hardlink and special files", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-guest-write-"))
  try {
    writeFileSync(join(root, "original"), "original")
    symlinkSync(join(root, "original"), join(root, "linked"))
    expect(await run(root, join(root, "linked"))).not.toBe(0)
    expect(await run(root, `${root}/../escaped`)).not.toBe(0)
    const { linkSync } = await import("node:fs")
    linkSync(join(root, "original"), join(root, "hardlinked"))
    expect(await run(root, join(root, "hardlinked"))).not.toBe(0)
    mkdirSync(join(root, "directory"))
    expect(await run(root, join(root, "directory"))).not.toBe(0)
    expect(readFileSync(join(root, "original"), "utf8")).toBe("original")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
for (const failure of [1, 2, 3])
  test(`B05 fsync failure ${failure} preserves the original guest state`, async () => {
    const root = mkdtempSync(join(tmpdir(), "touri-guest-sync-"))
    try {
      const path = join(root, "state")
      writeFileSync(path, "original")
      const code =
        `import os\noriginal_sync=os.fsync\ncalls=0\ndef sync(fd):\n global calls\n calls+=1\n if calls==${failure}: raise OSError('injected sync failure')\n original_sync(fd)\nos.fsync=sync\n` +
        GUEST_WRITE_COMMAND
      expect(await run(root, path, code)).not.toBe(0)
      expect(readFileSync(path, "utf8")).toBe("original")
      expect(readdirSync(root)).toEqual(["state"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
