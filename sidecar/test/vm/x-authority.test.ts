import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("B09 display authority is private, rotates per boot and refuses linked targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "touri-xauth-"))
  try {
    const code = `import os,runpy,stat,sys\nm=runpy.run_path(sys.argv[1]);p=sys.argv[2]+'/authority'\nm['prepare'](p,os.getuid(),os.getgid())\nfirst=open(p,'rb').read();assert stat.S_IMODE(os.stat(p).st_mode)==0o600;assert b'MIT-MAGIC-COOKIE-1' in first\nm['prepare'](p,os.getuid(),os.getgid());assert open(p,'rb').read()!=first\nos.unlink(p);os.symlink('/dev/null',p)\ntry: m['prepare'](p,os.getuid(),os.getgid())\nexcept ValueError: pass\nelse: raise AssertionError('linked target accepted')`
    const child = Bun.spawn(["python3", "-c", code, join(import.meta.dir, "../../src/vm/image/x-authority.py"), root], {
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(await child.exited).toBe(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
