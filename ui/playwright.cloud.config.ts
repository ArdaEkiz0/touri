import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "cloud.spec.ts",
  workers: 1,
  timeout: 30_000,
  use: {
    channel: "chrome",
    headless: true,
    baseURL: "http://127.0.0.1:1479",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  },
  webServer: [
    { command: "bun ../test/fakes/cloud-qa.ts", url: "http://127.0.0.1:1480/health", reuseExistingServer: false },
    {
      command: "bun run dev -- --host 127.0.0.1 --port 1479",
      url: "http://127.0.0.1:1479",
      reuseExistingServer: false,
    },
  ],
})
