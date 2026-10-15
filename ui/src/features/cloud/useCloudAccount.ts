import type { CloudAccountState } from "@touri/contracts"
import { useCallback, useEffect, useState } from "react"
import type { UiApi } from "../../api/client"
import { userFacingError } from "../../errors"

export const useCloudAccount = (api: UiApi | undefined, enabled: boolean) => {
  const [account, setAccount] = useState<CloudAccountState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (!api || !enabled) return
    try {
      setAccount(await api.request("GET /cloud/account", {}))
      setError(null)
    } catch (reason) {
      setAccount(null)
      setError(userFacingError(reason))
    }
  }, [api, enabled])
  useEffect(() => {
    if (enabled) void refresh()
    else setAccount(null)
    const timer = enabled ? setInterval(() => void refresh(), 5000) : undefined
    return () => clearInterval(timer)
  }, [enabled, refresh])
  return { account, setAccount, error, setError, refresh }
}
export const cloudHours = (seconds: number) =>
  `${(seconds / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`
export const cloudBytes = (bytes: number) =>
  `${(bytes / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GiB`
