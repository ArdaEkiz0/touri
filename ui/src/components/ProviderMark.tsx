import type { Provider } from "@touri/contracts"

export const providerName = (provider: Provider): string =>
  ({ codex: "Codex", claude: "Claude Code", opencode: "OpenCode" })[provider]

/** Original mark: two open brackets enclosing a small diamond. */
export const ProviderMark = ({ provider }: { provider: Provider }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4em" }}>
    {provider === "opencode" && (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M8 4H4v16h4M16 4h4v16h-4M12 8l4 4-4 4-4-4z" strokeLinejoin="round" />
      </svg>
    )}
    {providerName(provider)}
  </span>
)
