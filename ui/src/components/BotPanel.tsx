import type { Bot, BotGroup, MachineState, Routine } from "@touri/contracts"
import { useCallback, useEffect, useRef, useState } from "react"
import type { UiApi } from "../api/client"
import { userFacingError } from "../errors"
import { machineStatusLabel } from "../i18n"
import { machineStateForDisplay } from "../machineState"
import { BotAvatar } from "./BotAvatar"
import { BotComputer } from "./BotComputer"
import { BotLibrary } from "./BotLibrary"
import { useSegmentedControl } from "./Motion"
import { PanelIcon } from "./PanelIcon"
import { ProviderMark } from "./ProviderMark"
import "./bot-panel.css"

const tabs = ["Detalhes", "Biblioteca", "Computador"] as const
export const BotPanel = ({
  api,
  groups = [],
  onGroup,
  bot,
  machine: rawMachine,
  routines,
  paused,
  activeTurns = false,
  expanded,
  onExpand,
  onWindow,
  onClose,
  onSettings,
  onPermissions,
  onRole,
  libraryRequest,
  computerTabRequest = 0,
}: {
  api: UiApi
  groups?: BotGroup[]
  onGroup?: (group: BotGroup) => void
  bot: Bot
  machine?: MachineState | undefined
  routines: Routine[]
  paused: boolean
  activeTurns?: boolean
  expanded: boolean
  onExpand: () => void
  onWindow: () => Promise<void>
  onClose: () => void
  onSettings: () => void
  onPermissions: () => void
  onRole: (roleLine: string | null) => Promise<void>
  libraryRequest?: { path: string; request: number } | undefined
  computerTabRequest?: number
}) => {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Detalhes")
  useEffect(() => {
    if (computerTabRequest) setTab("Computador")
  }, [computerTabRequest])
  useEffect(() => {
    if (libraryRequest) setTab("Biblioteca")
  }, [libraryRequest])
  const [role, setRole] = useState(bot.roleLine ?? "")
  useEffect(() => {
    setRole(bot.roleLine ?? "")
  }, [bot.roleLine])
  const openComputer = useCallback(() => setTab("Computador"), [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRole = useRef(false)
  const tablist = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useSegmentedControl(tablist, tab)
  const machine = machineStateForDisplay(rawMachine)
  const saveRole = async () => {
    if (cancelRole.current) {
      cancelRole.current = false
      return
    }
    if (role.trim() === (bot.roleLine ?? "") || saving) return
    setSaving(true)
    setError(null)
    try {
      await onRole(role.trim() || null)
    } catch (reason) {
      setError(userFacingError(reason))
    } finally {
      setSaving(false)
    }
  }
  return (
    <aside
      className={`bot-panel ${expanded ? "bot-panel-expanded" : ""} ${tab === "Computador" ? "bot-panel-computer" : ""}`}
      id="bot-panel"
      aria-label={`Painel de ${bot.name}`}
    >
      <div className="bot-panel-top">
        <span>
          Seu bot <span className="panel-bot-name">· {bot.name}</span>
        </span>
        <button className="toolbar-icon" type="button" aria-label="Fechar painel do bot" onClick={onClose}>
          <PanelIcon name="close" />
        </button>
      </div>
      <header className="bot-panel-identity">
        <BotAvatar bot={bot} size={tab === "Computador" ? 48 : 72} />
        <h2>{bot.name}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void saveRole()
          }}
        >
          <label className="visually-hidden" htmlFor={`panel-role-${bot.id}`}>
            Rótulo do bot
          </label>
          <input
            id={`panel-role-${bot.id}`}
            value={role}
            maxLength={160}
            placeholder="Adicionar um rótulo"
            disabled={saving}
            onChange={(event) => setRole(event.target.value)}
            onBlur={() => void saveRole()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                cancelRole.current = true
                setRole(bot.roleLine ?? "")
                event.currentTarget.blur()
              }
            }}
          />
          <button className="visually-hidden" type="submit">
            Salvar rótulo
          </button>
        </form>
        {saving && <small role="status">Salvando rótulo…</small>}
        {error && (
          <p className="warning-callout" role="alert">
            {error}
          </p>
        )}
      </header>
      <div className="bot-panel-tabs motion-segments" role="tablist" aria-label="Painel do bot" ref={tablist}>
        {tabs.map((name, index) => (
          <button
            type="button"
            key={name}
            role="tab"
            id={`bot-tab-${index}`}
            aria-controls={`bot-tabpanel-${index}`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => {
              setTab(name)
              if (body.current) body.current.scrollTop = 0
              if (expanded && name !== "Computador") onExpand()
            }}
            onKeyDown={(event) => {
              const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
              if (!direction && event.key !== "Home" && event.key !== "End") return
              event.preventDefault()
              const next =
                event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + direction + tabs.length) % tabs.length
              const button = tablist.current?.querySelectorAll<HTMLButtonElement>("button")[next]
              button?.click()
              button?.focus()
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        ref={body}
        className="bot-panel-body"
        role="tabpanel"
        id={`bot-tabpanel-${tabs.indexOf(tab)}`}
        aria-labelledby={`bot-tab-${tabs.indexOf(tab)}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: tab panels are focusable per the ARIA tabs keyboard pattern
        tabIndex={0}
      >
        {tab === "Detalhes" && (
          <div className="bot-details">
            <section className="bot-details-section" aria-labelledby={`bot-profile-${bot.id}`}>
              <h3 id={`bot-profile-${bot.id}`}>Sobre o bot</h3>
              <dl>
                <div>
                  <dt>Função</dt>
                  <dd>{bot.roleLine || "Sem rótulo"}</dd>
                </div>
                <div>
                  <dt>Provedor</dt>
                  <dd>
                    <ProviderMark provider={bot.provider} />
                  </dd>
                </div>
                <div>
                  <dt>Modelo</dt>
                  <dd>{bot.model || "Padrão do provedor"}</dd>
                </div>
              </dl>
            </section>
            <section className="bot-details-section" aria-labelledby={`bot-environment-${bot.id}`}>
              <h3 id={`bot-environment-${bot.id}`}>Ambiente e acesso</h3>
              <dl>
                <div>
                  <dt>Nível de acesso</dt>
                  <dd>
                    {bot.access === "read-only"
                      ? "Somente leitura"
                      : bot.access === "workspace-write"
                        ? "Escrita na pasta de trabalho"
                        : "Acesso completo"}
                  </dd>
                </div>
                <div>
                  <dt>Computador</dt>
                  <dd>
                    {bot.machine === "vm"
                      ? `VM Linux · ${machineStatusLabel(machine?.status ?? "stopped", machine?.pauseReason)}`
                      : "Computador local"}
                  </dd>
                </div>
              </dl>
            </section>
            <div className="bot-quick-actions">
              <button className="button button-quiet" type="button" onClick={onSettings}>
                <PanelIcon name="settings" /> Configurações
              </button>
              <button className="button button-quiet" type="button" onClick={onPermissions}>
                <PanelIcon name="shield" /> Permissões
              </button>
            </div>
            <section className="bot-details-section">
              <h3>Grupos</h3>
              {groups.length ? (
                groups.map((group) => (
                  <button type="button" key={group.id} className="button button-quiet" onClick={() => onGroup?.(group)}>
                    {group.name}
                    {group.coordinatorBotId === bot.id ? " · coordenador" : ""}
                  </button>
                ))
              ) : (
                <p className="muted-copy">Este bot ainda não pertence a um grupo.</p>
              )}
            </section>
            <section className="bot-details-section" aria-labelledby={`bot-routines-${bot.id}`}>
              <div className="library-heading">
                <h3 id={`bot-routines-${bot.id}`}>Rotinas deste bot</h3>
                <span
                  className="count-pill"
                  title={`${routines.length} ${routines.length === 1 ? "rotina" : "rotinas"}`}
                >
                  {routines.length}
                </span>
              </div>
              {routines.length ? (
                <ul className="bot-routines">
                  {routines.map((routine) => (
                    <li key={routine.id}>
                      <PanelIcon name="clock" />
                      <div>
                        <strong>{routine.name}</strong>
                        <small>
                          {routine.enabled
                            ? routine.nextRunAt
                              ? `Próxima: ${new Date(routine.nextRunAt).toLocaleString("pt-BR", { timeZone: routine.timezone, dateStyle: "short", timeStyle: "short" })} · ${routine.timezone}`
                              : "Aguardando próximo agendamento"
                            : "Pausada"}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="bot-panel-empty">
                  <PanelIcon name="clock" />
                  <strong>Nenhuma rotina agendada</strong>
                  <p>Configure uma rotina para este bot cuidar de tarefas recorrentes.</p>
                  <button className="button button-quiet" type="button" onClick={onSettings}>
                    Configurar rotinas
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
        {tab === "Biblioteca" && (
          <BotLibrary key={bot.id} api={api} bot={bot} request={libraryRequest} onComputer={openComputer} />
        )}
        {tab === "Computador" && (
          <BotComputer
            key={bot.id}
            api={api}
            bot={bot}
            machine={machine}
            paused={paused}
            activeTurns={activeTurns}
            expanded={expanded}
            onExpand={onExpand}
            onWindow={onWindow}
            onPermissions={onPermissions}
          />
        )}
      </div>
    </aside>
  )
}
