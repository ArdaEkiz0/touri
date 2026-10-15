// Disposable shell fixture. Killing this PID simulates a Tauri crash, never the live app.
const child = Bun.spawn({
  cmd: [process.execPath, "run", new URL("../../src/main.ts", import.meta.url).pathname, "serve"],
  env: { ...process.env, TOURI_PARENT_PID: String(process.pid), TOURI_HEADLESS: "1" },
  stdout: "inherit",
  stderr: "inherit",
})
process.stdout.write(`${JSON.stringify({ childPid: child.pid })}\n`)
await child.exited
