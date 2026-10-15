import type { Kernel } from "@touri/contracts"

export const cliTelemetryOff = (kernel: Pick<Kernel, "services">): boolean =>
  kernel.services.use("store.settings")?.().cliTelemetry !== "cli-default"

/** Apply last, after authentication/settings merges, to native and guest launches alike. */
export const applyProviderPrivacy = (environment: Record<string, string>, off = true): Record<string, string> => {
  if (!off) return { ...environment }
  return {
    ...environment,
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    DO_NOT_TRACK: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    OTEL_SDK_DISABLED: "true",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
  }
}

export const providerPrivacyConfig = (off: boolean): string[] =>
  off
    ? [
        "-c",
        "analytics.enabled=false",
        "-c",
        'otel.exporter="none"',
        "-c",
        'otel.trace_exporter="none"',
        "-c",
        'otel.metrics_exporter="none"',
        "-c",
        "otel.log_user_prompt=false",
      ]
    : []
