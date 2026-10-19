import { expect, test } from "@playwright/test"

test.use({ channel: "chromium", locale: "pt-BR", reducedMotion: "reduce" })

for (const [width, height, size] of [
  [1440, 900, "desktop"],
  [390, 844, "mobile"],
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`Doctor storage journal label at ${width}px in ${theme} theme`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height })
      await page.addInitScript((value) => localStorage.setItem("touri.appearance.v1", value), theme)
      await page.goto("/test/e2e/r8-settings-harness.html")
      if (width < 600) await page.getByRole("button", { name: "Abrir menu", exact: true }).click()
      await page.getByRole("button", { name: /Você Local/ }).click()
      const dialog = page.getByRole("dialog")
      await dialog.getByRole("tab", { name: "Diagnóstico", exact: true }).click()
      await dialog.getByText("Verificar e cuidar deste computador", { exact: true }).click()

      const storage = dialog.getByRole("region", { name: "Armazenamento", exact: true })
      const summary = storage.locator("p").first()
      await expect(summary).toContainText("Registro temporário do banco")
      await expect(summary).not.toContainText("Diário")
      await page.addStyleTag({
        content: '.doctor-groups .doctor-group:not([aria-label="Armazenamento"]) { display: none !important; }',
      })
      const afterText = await summary.textContent()
      if (!afterText) throw new Error("Missing storage summary")
      const beforeText = afterText.replace("Registro temporário do banco", "Diário")
      expect(beforeText).not.toBe(afterText)
      await summary.evaluate((element, text) => {
        element.textContent = text
      }, beforeText)
      await storage.screenshot({
        path: testInfo.outputPath(`before-${size}-${theme}.png`),
        animations: "disabled",
      })
      await summary.evaluate((element, text) => {
        element.textContent = text
      }, afterText)
      await expect(summary).toContainText("Registro temporário do banco")
      await storage.screenshot({
        path: testInfo.outputPath(`after-${size}-${theme}.png`),
        animations: "disabled",
      })
    })
  }
}
