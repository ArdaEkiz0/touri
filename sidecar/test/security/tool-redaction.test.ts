import { expect, test } from "bun:test"
import { redactToolText } from "@touri/contracts/redaction"

test("r2: tool disclosure redacts structured secrets, known escaped values and common CLI credentials", () => {
  const secret = 'project-value-"escaped"'
  const original = JSON.stringify({
    command: "ls src/app",
    nested: { password: "hidden-password", output: secret },
    headers: { Authorization: "Bearer hidden-bearer" },
  })
  const safe = redactToolText(original, (value) => value.replaceAll(secret, "[REDACTED]"))
  expect(() => JSON.parse(safe)).not.toThrow()
  expect(safe).toContain("ls src/app")
  expect(safe).not.toMatch(/hidden-password|hidden-bearer|project-value/)
  expect(redactToolText("curl --api-key private-key API_TOKEN=hidden-token")).not.toMatch(/private-key|hidden-token/)
  expect(redactToolText("https://example.com/public")).toBe("https://example.com/public")
})
