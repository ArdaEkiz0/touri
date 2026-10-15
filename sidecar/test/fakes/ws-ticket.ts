export const socketTicket = async (port: number, path: string, token = "dev-ui-token"): Promise<string> => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/ws-ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "tauri://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })
  if (!response.ok) return "invalid-ticket"
  return ((await response.json()) as { ticket: string }).ticket
}
