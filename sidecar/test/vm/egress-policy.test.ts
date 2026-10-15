import { expect, test } from "bun:test"
import { join } from "node:path"
import { defaultEgressPolicy, tightenEgressPolicy, validateEgressPolicy } from "../../src/vm/egress-policy"

test("B11 S04 live policy forms an intersection; allowing LAN and new resolvers waits for restart", () => {
  const policies = [
    defaultEgressPolicy(),
    { allowLan: true, resolvers: ["1.1.1.1"], privateDomains: ["office.example"] },
    { allowLan: false, resolvers: ["8.8.8.8"], privateDomains: [] },
  ]
  for (const active of policies)
    for (const requested of policies) {
      const result = tightenEgressPolicy(active, requested)
      expect(result.allowLan && !active.allowLan).toBe(false)
      expect(result.resolvers.every((ip) => active.resolvers.includes(ip) && requested.resolvers.includes(ip))).toBe(
        true,
      )
      expect(active.privateDomains.every((domain) => result.privateDomains.includes(domain))).toBe(true)
      expect(tightenEgressPolicy(result, requested)).toEqual(result)
    }
  expect(tightenEgressPolicy(defaultEgressPolicy(), policies[1] ?? defaultEgressPolicy())).toMatchObject({
    allowLan: false,
    resolvers: ["1.1.1.1"],
  })
  expect(() => validateEgressPolicy({ allowLan: true, resolvers: ["1.1.1.1;accept"], privateDomains: [] })).toThrow()
})

test("B11 private, local, compressed and reverse DNS names never reach public resolvers", async () => {
  const code = `import runpy,struct\nm=runpy.run_path(${JSON.stringify(join(import.meta.dir, "../../src/vm/image/network-policy.py"))})\ndef packet(name):\n return b'\\x00\\x01\\x01\\x00\\x00\\x01'+b'\\x00'*6+b''.join(bytes([len(p)])+p.encode() for p in name.split('.'))+b'\\x00\\x00\\x01\\x00\\x01'\np={'privateDomains':['office.example']}\nfor name in ['localhost','printer.local','intranet','db.internal','auth.office.example','1.64.168.192.in-addr.arpa','metadata.google.internal']:\n assert not m['permitted_question'](packet(name),p),name\nassert not m['permitted_question'](b'\\x00'*12+b'\\xc0\\x00\\x00\\x01\\x00\\x01',p)\nassert m['permitted_question'](packet('api.openai.com'),p)\n`
  const child = Bun.spawn(["python3", "-c", code], { stdout: "pipe", stderr: "pipe" })
  expect(await child.exited).toBe(0)
})
