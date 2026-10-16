import { expect, it } from "vitest"
import { routineSchedule } from "../src/routineSchedule"

it.each([
  ["0 9 * * *", "Todo dia às 09:00"],
  ["5 8 * * *", "Todo dia às 08:05"],
  ["*/5 * * * *", "A cada 5 minutos"],
  ["* * * * *", "A cada minuto"],
  ["*/1 * * * *", "A cada minuto"],
  ["0 */2 * * *", "A cada 2 horas"],
  ["0 */1 * * *", "A cada hora"],
  ["0 * * * *", "A cada hora"],
  ["15 * * * *", "A cada hora, aos 15 minutos"],
  ["0 9 * * 1-5", "De segunda a sexta às 09:00"],
  ["0 9 * * 1", "Toda semana: segunda-feira às 09:00"],
  ["0 9 * * 0", "Toda semana: domingo às 09:00"],
  ["0 9 15 * *", "Todo dia 15 do mês às 09:00"],
  ["*/7 * * * *", "Agenda personalizada"],
  ["0 9 1 1 *", "Agenda personalizada"],
])("F013 describes %s accurately in pt-BR", (cron, label) => {
  expect(routineSchedule(cron, "America/Sao_Paulo")).toBe(`${label} · horário de São Paulo`)
})

it("preserves other timezones instead of claiming São Paulo time", () => {
  expect(routineSchedule("0 9 * * *", "UTC")).toBe("Todo dia às 09:00 · UTC")
})
