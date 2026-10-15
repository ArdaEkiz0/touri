const { randomBytes } = require("node:crypto")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")

process.umask(0o077)
const path = process.argv[2] ?? "/tmp/touri-vnc/passwd"
// Arbitrary rfbauth ciphertext could decrypt to a short/empty C string. Always
// encode eight printable characters, including before sidecar configuration.
const password = randomBytes(6).toString("base64")
const stored = spawnSync("x11vnc", ["-storepasswd", path], {
  input: `${password}\n${password}\ny\n`,
  stdio: ["pipe", "ignore", "ignore"],
})
if (stored.status !== 0) process.exit(1)
fs.chmodSync(path, 0o600)
