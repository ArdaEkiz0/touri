import { defineConfig } from "@playwright/test"
import config from "./playwright.config"

const use = {
  ...config.use,
  channel: "chromium",
  timezoneId: "America/Sao_Paulo",
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
    : {}),
}

export default defineConfig({
  ...config,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use,
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : {
        webServer: {
          command:
            "VITE_ENABLE_MOCK=true bun run dev -- --config vite.integrated.config.ts --host 127.0.0.1 --port 1448",
          url: "http://127.0.0.1:1448",
          reuseExistingServer: false,
          timeout: 30_000,
        },
        use: { ...use, baseURL: "http://127.0.0.1:1448" },
      }),
})
