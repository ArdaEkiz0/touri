import type { DoctorCheck, DoctorStatus } from "@touri/contracts"

export const check = (
  id: string,
  label: string,
  status: DoctorStatus,
  detail: string,
  fix: string | null = null,
): DoctorCheck => ({ id, label, status, ok: status === "pass", detail, fix: status === "pass" ? null : fix })

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
