import type { Bot, BrowserFailureInfo } from "@touri/contracts"
import { useEffect, useRef, useState } from "react"
import type { UiApi } from "../../api/client"
import { PanelIcon } from "../../components/PanelIcon"
import { computerKillSwitchEvent } from "../../computerKillSwitch"
import { useComputerPresence } from "../../machineIntents"
import { createDesktopKeyboard } from "./keyboard"
import { DisplayLiveness, isEmptyDisplay } from "./liveness"
import { withTimeout } from "./withTimeout"
import "./desktop.css"

type Viewer = import("@novnc/novnc").default
type Phase = "connecting" | "ready" | "stalled" | "paused"
type Stage = "session" | "channel" | "image"

const SESSION_TIMEOUT_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 15_000
const SESSION_TIMEOUT_MESSAGE =
  "A VM não respondeu ao pedido da tela em 30 s. Confira se a máquina está ligada (Doctor) e reconecte."
const HANDSHAKE_TIMEOUT_MESSAGE =
  "A tela da VM não respondeu em 15 s. Verifique se a máquina está ligada; se continuar, reinicie a máquina."
const STAGE_TEXT: Record<Stage, string> = {
  session: "Pedindo a sessão da tela à VM…",
  channel: "Abrindo o canal da tela…",
  image: "Sem imagem ainda. Aguardando a primeira imagem da VM.",
}

const FAILURE_POLL_MS = 3_000

const FIRST_IMAGE_TIMEOUT_MESSAGE =
  "A tela da VM conectou, mas não enviou nenhuma imagem. Reconecte; se continuar, reinicie a máquina."

export const DesktopPanel = ({
  api,
  bot,
  paused = false,
  onControlChange,
}: {
  api: UiApi
  bot: Bot
  paused?: boolean
  onControlChange?: (active: boolean) => void
}) => {
  useComputerPresence(api, bot)
  const slot = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [phase, setPhase] = useState<Phase>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [emptyDisplay, setEmptyDisplay] = useState(false)
  const [stage, setStage] = useState<Stage>("session")
  const [attempt, setAttempt] = useState(0)
  const [requestedControl, setRequestedControl] = useState(false)
  const [controlling, setControlling] = useState(false)
  const lastConnection = useRef<string | null>(null)
  const [browserFailure, setBrowserFailure] = useState<BrowserFailureInfo | null>(null)

  useEffect(() => {
    onControlChange?.(controlling)
    return () => onControlChange?.(false)
  }, [controlling, onControlChange])

  useEffect(() => {
    if (paused || !bot.computerUse) setRequestedControl(false)
  }, [paused, bot.computerUse])

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly reconnects the viewer
  useEffect(() => {
    const container = slot.current
    const textarea = input.current
    if (!container || !textarea) return
    if (paused) {
      setPhase("paused")
      setControlling(false)
      return
    }
    let active = true
    let connected = false
    let displayed = false
    let viewer: Viewer | null = null
    let socket: WebSocket | null = null
    let sessionId: string | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    let monitor = new DisplayLiveness(performance.now())
    let sampleNow: (() => void) | null = null
    const keyboard = createDesktopKeyboard(
      {
        sendKey: (symbol, code, down) => {
          if (!viewer || viewer.viewOnly) return
          monitor.input(performance.now())
          viewer.sendKey(symbol, code, down)
        },
        pasteText: async (text) => {
          if (!viewer || viewer.viewOnly || !sessionId || !connected || failed) return
          const id = sessionId
          const pasteViewer = viewer
          monitor.input(performance.now())
          try {
            await api.request("POST /desktop/:id/text", { text }, { id })
          } catch {
            if (active && sessionId === id && viewer === pasteViewer)
              fail("Não foi possível colar o texto na VM. Reconecte e tente novamente.")
          }
        },
      },
      /Mac|iPhone|iPad/.test(navigator.platform),
    )
    const releaseSession = () => {
      const id = sessionId
      sessionId = null
      if (id) void api.request("DELETE /desktop/:id", {}, { id }).catch(() => undefined)
    }
    const stop = () => {
      keyboard.reset()
      connected = false
      displayed = false
      if (viewer) viewer.viewOnly = true
      viewer?.disconnect()
      socket?.close()
      releaseSession()
      clearInterval(timer)
      clearTimeout(handshakeTimer)
      clearTimeout(retryTimer)
    }
    let failed = false
    const fail = (message?: string, recover = true) => {
      if (!active || failed) return
      failed = true
      stop()
      setPhase("stalled")
      setControlling(false)
      setError(message ?? null)
      if (recover && lastConnection.current === bot.id && retries < 5) {
        const delay = Math.min(16_000, 1_000 * 2 ** retries++)
        setError(message ? `${message} Reconectando…` : "A conexão com a tela foi interrompida. Reconectando…")
        retryTimer = setTimeout(() => {
          if (!active) return
          failed = false
          setPhase("connecting")
          void connect().catch((reason: unknown) =>
            fail(reason instanceof Error ? reason.message : "Tela indisponível"),
          )
        }, delay)
      }
    }
    const visibility = () => {
      // Browsers suspend timers in hidden windows; allow a fresh display sample on return.
      keyboard.reset()
      textarea.value = ""
      monitor = new DisplayLiveness(performance.now())
      if (!document.hidden) sampleNow?.()
    }
    const canType = () => connected && displayed && viewer !== null && !viewer.viewOnly
    const pointerInput = (event: Event) => {
      if (canType() && event.target instanceof HTMLCanvasElement) monitor.input(performance.now())
    }
    // noVNC stops propagation; capture input on its canvas before its handlers run.
    const pointerEvents = ["mousedown", "mouseup", "mousemove", "wheel", "gesturestart", "gesturemove", "gestureend"]
    const keydown = (event: KeyboardEvent) => {
      if (canType()) keyboard.keydown(event)
    }
    const keyup = (event: KeyboardEvent) => {
      if (canType()) keyboard.keyup(event)
    }
    const compositionstart = () => {
      if (canType()) keyboard.compositionstart()
    }
    const compositionend = (event: CompositionEvent) => {
      if (canType()) keyboard.compositionend(event.data)
      textarea.value = ""
    }
    const textInput = (event: Event) => {
      if (!canType() || keyboard.input(textarea.value, (event as InputEvent).isComposing)) textarea.value = ""
    }
    const focusInput = () => {
      if (canType()) {
        viewer?.blur()
        textarea.focus({ preventScroll: true })
      }
    }
    const blur = () => {
      keyboard.reset()
      textarea.value = ""
    }
    const revoke = () => {
      if (!requestedControl && (!viewer || viewer.viewOnly)) return
      fail("O controle foi interrompido.", false)
      setRequestedControl(false)
    }
    textarea.addEventListener("keydown", keydown)
    textarea.addEventListener("keyup", keyup)
    textarea.addEventListener("compositionstart", compositionstart)
    textarea.addEventListener("compositionend", compositionend)
    textarea.addEventListener("input", textInput)
    textarea.addEventListener("blur", blur)
    // noVNC captures the pointer on mousedown, so the click lands outside the canvas; focus first.
    container.addEventListener("mousedown", focusInput, true)
    container.addEventListener("focusin", focusInput)
    for (const event of pointerEvents) container.addEventListener(event, pointerInput, true)
    document.addEventListener("visibilitychange", visibility)
    window.addEventListener(computerKillSwitchEvent, revoke)
    setPhase("connecting")
    setEmptyDisplay(false)
    setError(null)
    setControlling(false)
    const connect = async () => {
      if (!api.websocketUrl || api.isMock)
        throw new Error("A conexão com o computador está indisponível. Tente novamente.")
      const { default: RFB } = await import("@novnc/novnc")
      if (!active) return
      setStage("session")
      const session = await withTimeout({
        work: api.request(
          "POST /bots/:id/desktop",
          {
            control: retries === 0 && requestedControl && bot.computerUse,
            ...(lastConnection.current === bot.id ? { resume: true } : {}),
          },
          { id: bot.id },
        ),
        ms: SESSION_TIMEOUT_MS,
        message: SESSION_TIMEOUT_MESSAGE,
      })
      sessionId = session.sessionId
      if (!active) return releaseSession()
      setStage("channel")
      const socketUrl = await withTimeout({
        work: Promise.resolve(api.websocketUrl(session.path)),
        ms: SESSION_TIMEOUT_MS,
        message: SESSION_TIMEOUT_MESSAGE,
      })
      if (!active) return
      setStage("image")
      socket = new WebSocket(socketUrl)
      const currentSocket = socket
      socket.binaryType = "arraybuffer"
      socket.addEventListener("close", (event) => {
        if (!active || socket !== currentSocket) return
        console.warn("Conexão da tela encerrada", { botId: bot.id, code: event.code })
        if ([1008, 4001, 4003].includes(event.code)) clearTimeout(retryTimer)
        fail(undefined, ![1008, 4001, 4003].includes(event.code))
      })
      viewer = new RFB(container, socket, { shared: true })
      const currentViewer = viewer
      viewer.viewOnly = !session.control
      viewer.scaleViewport = true
      viewer.resizeSession = false
      viewer.focusOnClick = false
      viewer.addEventListener("connect", () => {
        if (!active || failed || viewer !== currentViewer) return
        clearTimeout(handshakeTimer)
        connected = true
        lastConnection.current = bot.id
        monitor = new DisplayLiveness(performance.now())
        // All keyboard input goes through the composition-aware textarea.
        const canvas = container.querySelector("canvas")
        if (canvas) canvas.tabIndex = -1
        // An occluded window (e.g. a popout behind the main window) still shows its first image.
        const sample = () => {
          if (!active || failed || !connected || !viewer || (document.hidden && displayed)) return
          const at = performance.now()
          try {
            const image = viewer.getImageData()
            const painted = monitor.image(image, at)
            setEmptyDisplay(painted && isEmptyDisplay(image))
            if (painted && !displayed) {
              displayed = true
              setPhase("ready")
              setControlling(session.control)
              retries = 0
            }
            if (!monitor.alive(at)) fail(displayed ? undefined : FIRST_IMAGE_TIMEOUT_MESSAGE)
          } catch {
            fail()
          }
        }
        sampleNow = sample
        sample()
        timer = setInterval(sample, 1_000)
      })
      viewer.addEventListener("disconnect", () => {
        if (viewer === currentViewer) fail()
      })
      viewer.addEventListener("securityfailure", () => {
        if (viewer === currentViewer) fail("Não foi possível abrir a tela da VM", false)
      })
      handshakeTimer = setTimeout(() => fail(HANDSHAKE_TIMEOUT_MESSAGE), HANDSHAKE_TIMEOUT_MS)
    }
    void connect().catch((reason: unknown) => fail(reason instanceof Error ? reason.message : "Tela indisponível"))
    return () => {
      active = false
      stop()
      textarea.value = ""
      textarea.removeEventListener("keydown", keydown)
      textarea.removeEventListener("keyup", keyup)
      textarea.removeEventListener("compositionstart", compositionstart)
      textarea.removeEventListener("compositionend", compositionend)
      textarea.removeEventListener("input", textInput)
      textarea.removeEventListener("blur", blur)
      container.removeEventListener("mousedown", focusInput, true)
      container.removeEventListener("focusin", focusInput)
      for (const event of pointerEvents) container.removeEventListener(event, pointerInput, true)
      document.removeEventListener("visibilitychange", visibility)
      window.removeEventListener(computerKillSwitchEvent, revoke)
    }
  }, [api, bot.id, bot.computerUse, paused, requestedControl, attempt])

  useEffect(() => {
    if (phase !== "ready" || !emptyDisplay || api.isMock) return
    let active = true
    const poll = () =>
      api
        .request("GET /browser/tabs", { botId: bot.id })
        .then(({ lastFailure }) => {
          if (active) setBrowserFailure(lastFailure ?? null)
        })
        .catch(() => {})
    void poll()
    const timer = setInterval(() => void poll(), FAILURE_POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [api, bot.id, phase, emptyDisplay])

  const reconnect = () => {
    setRequestedControl(false)
    setAttempt((value) => value + 1)
  }
  return (
    <section className="desktop-panel" aria-label={`Tela da VM de ${bot.name}`}>
      <header className="desktop-toolbar">
        <h2 className="desktop-title">Tela da VM</h2>
        <span className="desktop-mode" role="status">
          {controlling ? "Controle ativo" : "Somente observar"}
        </span>
        <div className="toolbar-actions">
          <button
            type="button"
            className="button button-quiet"
            aria-pressed={controlling}
            disabled={!bot.computerUse || phase !== "ready"}
            title={
              !bot.computerUse ? "Ative a permissão de controle do computador nas configurações do bot" : undefined
            }
            onClick={() => {
              setRequestedControl(!controlling)
              setAttempt((value) => value + 1)
            }}
          >
            {controlling ? "Parar controle" : "Controlar"}
          </button>
          <button type="button" className="button button-quiet" disabled={paused} onClick={reconnect}>
            Reconectar
          </button>
        </div>
      </header>
      <div className="desktop-display" data-phase={phase}>
        <div ref={slot} className="desktop-canvas" />
        {phase === "ready" && emptyDisplay && (
          <div className="desktop-status desktop-empty" role="status">
            <PanelIcon name="computer" />
            {browserFailure ? (
              <>
                <strong>O navegador não abriu a página</strong>
                <p>{browserFailure.error}</p>
              </>
            ) : (
              <>
                <strong>Navegador ainda não aberto</strong>
                <p>Peça ao bot para abrir uma página. Ela aparecerá aqui na tela da VM.</p>
              </>
            )}
          </div>
        )}
        {phase !== "ready" && (
          <div className="desktop-status" role="status">
            {phase === "stalled" ? (
              <>
                <PanelIcon name="computer" />
                <strong>Não foi possível receber a imagem</strong>
                <p>{error ?? "A conexão com a tela foi interrompida. Reconecte para continuar."}</p>
                <button type="button" className="button button-brand" onClick={reconnect}>
                  Tela travada — reconectar
                </button>
              </>
            ) : (
              <>
                <PanelIcon name="computer" />
                <strong>{phase === "paused" ? "Tela pausada" : "Conectando…"}</strong>
                <p>{phase === "paused" ? "A tela voltará quando a conexão for retomada." : STAGE_TEXT[stage]}</p>
              </>
            )}
          </div>
        )}
      </div>
      <div className={`desktop-input ${controlling ? "" : "desktop-input-observe"}`}>
        {!controlling && (
          <p className="desktop-observe-note">Somente observar. Ative Controlar para usar o teclado e o mouse.</p>
        )}
        <label htmlFor={`desktop-input-${bot.id}`}>Digitar na VM</label>
        <textarea
          ref={input}
          id={`desktop-input-${bot.id}`}
          rows={1}
          disabled={!controlling || phase !== "ready"}
          placeholder={
            controlling ? "Digite aqui ou clique na tela para usar o teclado" : "Ative Controlar para digitar"
          }
          aria-describedby={`desktop-help-${bot.id}`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <small id={`desktop-help-${bot.id}`}>⌘ equivale a Ctrl na VM. Texto composto é enviado ao confirmar.</small>
      </div>
    </section>
  )
}
