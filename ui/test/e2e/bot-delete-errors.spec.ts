import { expect, test } from "@playwright/test"

test.use({ channel: "chromium" })

test("bot deletion explains an active machine and allows retry", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto("/test/e2e/bot-delete-error-harness.html")
  await page.getByLabel("Digite o nome do bot: mark").fill("mark")

  await page.getByRole("button", { name: "Excluir bot" }).click()

  await expect(page.getByRole("alert")).toHaveText(
    "O computador do bot ainda está em uso. Pare as tarefas e tente excluir novamente. [TOURI-E8004]",
  )
  await expect(page.getByRole("button", { name: "Excluir bot" })).toBeEnabled()
  await page
    .getByRole("alert")
    .screenshot({ path: testInfo.outputPath("bot-delete-blocker.png"), animations: "disabled" })
})

test("bot deletion explains pending cleanup and automatic retries", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto("/test/e2e/bot-delete-error-harness.html?cleanup=pending")
  await page.getByLabel("Digite o nome do bot: mark").fill("mark")

  await page.getByRole("button", { name: "Excluir bot" }).click()

  await expect(page.getByRole("alert")).toHaveText(
    "O bot foi excluído, mas a limpeza dos anexos privados está pendente. O touri tentará concluir a limpeza automaticamente. [TOURI-E2015]",
  )
  await expect(page.getByRole("button", { name: "Excluir bot" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Fechar", exact: true })).toBeEnabled()
  await page
    .getByRole("alert")
    .screenshot({ path: testInfo.outputPath("bot-delete-cleanup-pending.png"), animations: "disabled" })
})
