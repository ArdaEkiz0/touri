import { defineConfig } from "@playwright/test"
import config from "./playwright.config"

export default defineConfig({
  ...config,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { ...config.use, channel: "chromium" },
})
