import type { Provider } from "@touri/contracts"
import { useEffect, useId, useState } from "react"
import type { UiApi } from "../api/client"

export const ProviderModelField = ({
  id,
  api,
  provider,
  botId,
  value,
  onChange,
}: {
  id: string
  api?: UiApi | undefined
  provider: Provider
  botId?: string | undefined
  value: string
  onChange: (value: string) => void
}) => {
  const listId = useId()
  const [models, setModels] = useState<string[]>([])
  const [defaultModel, setDefaultModel] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  useEffect(() => {
    let current = true
    setModels([])
    setDefaultModel(null)
    setStatus("")
    if (provider !== "opencode") return
    if (!api) {
      setStatus("Informe o modelo no formato provedor/modelo, por exemplo openrouter/deepseek/deepseek-v3.2.")
      return
    }
    setStatus("Carregando modelos do OpenCode…")
    void api
      .request("GET /providers/opencode/models", botId ? { botId } : {})
      .then((result) => {
        if (!current) return
        setModels(result.models)
        setDefaultModel(result.defaultModel)
        setStatus(
          result.available
            ? result.defaultModel
              ? `Padrão: ${result.defaultModel}. Você também pode informar outro modelo.`
              : "Selecione um modelo ou use o padrão do OpenCode."
            : "OpenCode indisponível. Instale a CLI e confira o Doctor; você pode informar o modelo manualmente.",
        )
      })
      .catch(() => {
        if (current)
          setStatus("Não foi possível listar os modelos. Informe o identificador provedor/modelo manualmente.")
      })
    return () => {
      current = false
    }
  }, [api, provider, botId])
  return (
    <>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={provider === "opencode" ? listId : undefined}
        placeholder={defaultModel ?? "Padrão da CLI"}
        aria-describedby={provider === "opencode" ? `${listId}-status` : undefined}
      />
      {provider === "opencode" && (
        <>
          <datalist id={listId}>
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <small id={`${listId}-status`} role="status">
            {status}
          </small>
        </>
      )}
    </>
  )
}
