import type { MachineConnection } from "@touri/contracts"
import type { VmPortForward } from "./types"

export const machineConnection = ({
  id,
  provider,
  ports,
  authKeyId = null,
}: {
  id: string
  provider: string
  ports: Array<VmPortForward>
  authKeyId?: string | null
}): MachineConnection => {
  const mappings = ports.map((port) => ({ ...port, url: port.url ?? `http://${port.hostIp}:${port.hostPort}` }))
  const endpoint = (guestPort: number) => mappings.find((port) => port.guestPort === guestPort)?.url ?? ""
  return {
    machineId: id,
    provider,
    endpoints: { browser: endpoint(9222), bridge: endpoint(9876).replace(/^http:/, "tcp:") },
    ports: mappings,
    display: { name: ":99", width: 1440, height: 900 },
    bridge: {
      guestPort: 9876,
      socketPath: "/tmp/touri-mcp.sock",
      connectionFile: "/workspace/.touri/run/connection.sealed.json",
    },
    authKeyId,
  }
}
