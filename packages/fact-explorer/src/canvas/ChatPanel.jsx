// Fact Explorer analogue of the credit-assistant audit panel's "Explain & Analyze" tab
// (audit-panel.js `_sendChatMessage`). A floating chat button sits just above the
// React Flow controls (bottom-left); clicking it opens a resizable chat dock that
// pins under the Fact Explorer header and reaches down toward the controls. The user
// picks one or more facts to attach as context, types a prompt, and the same
// FastAPI `/chat` endpoint is called with a `{ prompt, tracked_facts }` body.
//
// Unlike the audit panel — which reads live values out of `window.factGraph` — Fact
// Explorer has no live graph, so tracked-fact values come from the active scenario
// overlay (`scenarioValues`, keyed by fact path) and the dependency tree is walked
// over the static FGM (`factByPath` → `dependencyPaths`).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { buildTrackedFacts } from '../model/explainContext.js'
import { renderMarkdown } from '../util/markdown.js'
import { useResizable } from '../hooks/useResizable.js'
import { getConfig } from 'taxpert/config'

// Read at call time, not module-eval: registerFactExplorerHost() calls configure() after this
// module is imported, and the Workspace settings modal can edit apiBase later still. Same order
// taxpert's own chat.js uses — a second copy of the default URL is exactly what the two files
// used to disagree about.
const chatApiUrl = () => `${getConfig().endpoints.apiBase}/chat`
const CHAT_TIMEOUT_MS = 90_000
const CHAT_STORAGE_KEY = 'factExplorerChat'

// Dock geometry. The panel is BOTTOM-anchored: it pops open at a fixed height just
// above the launcher button and grows upward, so collapsing the header never moves
// it. It's then resized via custom top/bottom (vertical) and right (horizontal)
// handles. CHAT_DEFAULT_H / CHAT_LAUNCHER_GAP are the easy knobs to tune.
const CHAT_MIN_W = 280
const CHAT_MIN_H = 140
const CHAT_DEFAULT_W = 360
const CHAT_DEFAULT_H = 350 // initial dock height
const CHAT_MAX_W_RATIO = 0.6
const CHAT_TOP_MARGIN = 16 // min gap kept between the header and the dock's top edge

// Launcher geometry — must match the button rendered below — so the dock can sit a
// fixed gap directly above it.
const LAUNCHER_BOTTOM = 150 // launcher's distance from the canvas bottom
const LAUNCHER_SIZE = 40
const CHAT_LAUNCHER_GAP = 10 // gap between the dock's bottom edge and the launcher
const CHAT_DEFAULT_BOTTOM = LAUNCHER_BOTTOM + LAUNCHER_SIZE + CHAT_LAUNCHER_GAP // = 200
const RESIZE_STEP = 24 // keyboard nudge per arrow press

// ── component ───────────────────────────────────────────────────────────────────

function ChatPanel(
  { facts, factByPath, scenarioValues, appLabel = 'this', headerBottom = 96 },
  ref
) {
  const [open, setOpen] = useState(false)

  // The dock's geometry, owned entirely here so it never re-flows with the header.
  // Bottom-anchored: `bottom` is the distance from the canvas bottom to the dock's
  // bottom edge; the dock grows upward via `height`.
  const sectionRef = useRef(null)
  const [box, setBox] = useState({
    bottom: CHAT_DEFAULT_BOTTOM,
    width: CHAT_DEFAULT_W,
    height: CHAT_DEFAULT_H,
  })
  // Mirror the box into a ref so useResizable's getState() always reads the
  // latest geometry (the hook captures it once per gesture / keystroke).
  const boxRef = useRef(box)
  boxRef.current = box
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  })
  const [tracked, setTracked] = useState([]) // array of fact paths
  const [factInput, setFactInput] = useState('')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const messagesRef = useRef(null)

  // Persist + autoscroll on new messages.
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    } catch {
      /* storage full/unavailable */
    }
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Each time it opens, pop the dock back to its default size just above the
  // launcher. Width is preserved across opens; bottom/height reset.
  useEffect(() => {
    if (!open) return
    setBox((b) => ({ ...b, bottom: CHAT_DEFAULT_BOTTOM, height: CHAT_DEFAULT_H }))
  }, [open])

  // Sorted, de-duped fact paths for the datalist.
  const factPaths = useMemo(() => [...new Set((facts ?? []).map((f) => f.path))].sort(), [facts])

  const addFact = (path) => {
    const p = (path ?? factInput).trim()
    if (!p) return
    if (!factPaths.includes(p)) return
    setTracked((t) => (t.includes(p) ? t : [...t, p]))
    setFactInput('')
  }

  const removeFact = (path) => setTracked((t) => t.filter((p) => p !== path))

  // The single request lifecycle, shared by the manual composer (send) and the
  // imperative explain() entry point. Appends the user prompt, posts
  // { prompt, tracked_facts, context } to the agent, and renders the answer.
  async function postChat({ prompt: text, trackedFacts, context = null }) {
    if (!text || busy) return

    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    setStatus('Thinking…')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)

    // Tick a "Thinking… (Ns)" status while we wait.
    let elapsed = 0
    const dots = ['', '.', '..', '...']
    const tick = setInterval(() => {
      elapsed++
      setStatus(`Thinking${dots[elapsed % dots.length]} (${elapsed}s)`)
    }, 1000)

    try {
      const res = await fetch(chatApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          tracked_facts: trackedFacts,
          context,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatus(`Error: ${data.detail ?? res.statusText}`)
        return
      }
      const data = await res.json()
      setMessages((m) => [...m, { role: 'assistant', content: data.content }])
      setStatus('')
    } catch (err) {
      if (err.name === 'AbortError') {
        setStatus('Request timed out — the backend took too long to respond.')
      } else {
        setStatus(`Error: ${err.message ?? 'Request failed'}`)
      }
    } finally {
      clearTimeout(timeoutId)
      clearInterval(tick)
      setBusy(false)
    }
  }

  function send() {
    const text = prompt.trim()
    if (!text || busy) return
    setPrompt('')
    postChat({
      prompt: text,
      trackedFacts: buildTrackedFacts(tracked, factByPath, scenarioValues),
    })
  }

  // Imperative entry point for the "Explain this node" buttons (DetailPanel
  // header, canvas badge, scenario summary). Opens the dock, attaches the node's
  // fact paths as visible chips, and fires the auto-generated prompt + structured
  // context in one shot.
  useImperativeHandle(
    ref,
    () => ({
      explain({ prompt: p, trackedPaths = [], context = null }) {
        if (!p || busy) return
        setOpen(true)
        if (trackedPaths.length) {
          setTracked((t) => [
            ...new Set([...t, ...trackedPaths.filter((x) => factPaths.includes(x))]),
          ])
        }
        postChat({
          prompt: p,
          trackedFacts: buildTrackedFacts(trackedPaths, factByPath, scenarioValues),
          context,
        })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [factPaths, factByPath, scenarioValues, busy, tracked]
  )

  const clearChat = () => {
    setMessages([])
    setStatus('')
  }

  // Edge-resize plumbing via the shared hook. The dock is bottom-anchored, so:
  //  'top'    — keeps the bottom edge fixed, grows/shrinks height (capped so the
  //             top edge can't slide under the header).
  //  'bottom' — keeps the top edge fixed, moves the bottom edge (no closer to the
  //             canvas bottom than the launcher gap).
  //  'right'  — changes width.
  const { beginResize, resizeKeyDown } = useResizable({
    edges: ['top', 'bottom', 'right'],
    getState: () => boxRef.current,
    setState: setBox,
    // Bounds measured against the canvas container the dock lives in, at gesture start.
    getBounds: () => {
      const container = sectionRef.current?.parentElement
      const containerH = container?.clientHeight ?? window.innerHeight
      const containerW = container?.clientWidth ?? window.innerWidth
      return {
        containerH,
        maxW: Math.max(CHAT_MIN_W, containerW * CHAT_MAX_W_RATIO),
        topCeiling: headerBottom + CHAT_TOP_MARGIN,
      }
    },
    resize: (edge, { dx, dy }, start, { containerH, maxW, topCeiling }) => {
      let { bottom, height, width } = start
      if (edge === 'top') {
        const maxH = containerH - start.bottom - topCeiling
        height = Math.max(CHAT_MIN_H, Math.min(start.height - dy, maxH))
      } else if (edge === 'bottom') {
        const maxBottom = start.bottom + start.height - CHAT_MIN_H
        bottom = Math.max(CHAT_DEFAULT_BOTTOM, Math.min(start.bottom - dy, maxBottom))
        height = start.bottom + start.height - bottom
      } else {
        width = Math.max(CHAT_MIN_W, Math.min(start.width + dx, maxW))
      }
      return { bottom, height, width }
    },
    // Arrow keys nudge by RESIZE_STEP, mapped to the {dx,dy} the resizer expects.
    // up = taller (top), down = lower edge (bottom), right = wider.
    keyStep: RESIZE_STEP,
    keyDelta: (edge, key, step) => {
      if (edge === 'top') {
        if (key === 'ArrowUp') return { dx: 0, dy: -step }
        if (key === 'ArrowDown') return { dx: 0, dy: step }
      } else if (edge === 'bottom') {
        if (key === 'ArrowDown') return { dx: 0, dy: -step }
        if (key === 'ArrowUp') return { dx: 0, dy: step }
      } else if (edge === 'right') {
        if (key === 'ArrowRight') return { dx: step, dy: 0 }
        if (key === 'ArrowLeft') return { dx: -step, dy: 0 }
      }
      return null
    },
  })

  return (
    <>
      {/* Floating launcher — sits just above the bottom-left React Flow controls. */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide Explain & Analyze' : 'Explain & Analyze'}
        aria-label={open ? 'Hide chat' : 'Open chat'}
        aria-expanded={open}
        className={`chat-launcher${open ? ' chat-launcher--open' : ''}`}
      >
        <ChatGlyph />
      </button>

      {open && (
        <section
          ref={sectionRef}
          aria-label="Explain & Analyze chat"
          className="chat-dock"
          style={{ bottom: box.bottom, width: box.width, height: box.height }}
        >
          {/* Resize handles: top + bottom (vertical), right (horizontal). */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chat from top"
            tabIndex={0}
            onPointerDown={beginResize('top')}
            onKeyDown={resizeKeyDown('top')}
            className="chat-handle chat-handle--top"
          />
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize chat from bottom"
            tabIndex={0}
            onPointerDown={beginResize('bottom')}
            onKeyDown={resizeKeyDown('bottom')}
            className="chat-handle chat-handle--bottom"
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat width"
            tabIndex={0}
            onPointerDown={beginResize('right')}
            onKeyDown={resizeKeyDown('right')}
            className="chat-handle chat-handle--right"
          />

          {/* Header */}
          <div className="chat-dock__header">
            <strong className="chat-dock__title">Explain &amp; Analyze</strong>
            <div className="chat-dock__header-actions">
              <button onClick={clearChat} className="chat-link-btn" title="Close conversation">
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="chat-link-btn"
                aria-label="Close chat"
              >
                Close
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={messagesRef}
            aria-live="polite"
            aria-label="Chat conversation"
            className="chat-dock__messages"
          >
            {messages.length === 0 && (
              <div className="chat-empty">
                {`Attach facts for context, then ask about the ${appLabel} flow.`}
              </div>
            )}
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`chat-message chat-message--${m.role === 'user' ? 'user' : 'assistant'}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
            ))}
          </div>

          {status && <div className="chat-status">{status}</div>}

          {/* Tracked-fact chips */}
          {tracked.length > 0 && (
            <div className="chat-chips">
              {tracked.map((p) => (
                <span key={p} className="chat-fact-chip" title={p}>
                  <span className="chat-fact-chip__label">{p}</span>
                  <button
                    onClick={() => removeFact(p)}
                    aria-label={`Remove ${p}`}
                    className="chat-fact-chip__remove"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Fact picker */}
          <div className="chat-picker">
            <input
              list="fact-explorer-chat-fact-options"
              value={factInput}
              onChange={(e) => setFactInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFact()
                }
              }}
              placeholder="Attach a fact path…"
              className="chat-picker__input"
            />
            <datalist id="fact-explorer-chat-fact-options">
              {factPaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <button onClick={() => addFact()} className="chat-small-btn" title="Attach fact">
              Add
            </button>
          </div>

          {/* Prompt + send */}
          <div className="chat-composer">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={`Ask about the ${appLabel} flow… (Ctrl+Enter to send)`}
              rows={2}
              className="chat-composer__input"
            />
            <button
              onClick={send}
              disabled={busy || !prompt.trim()}
              className="chat-small-btn chat-send-btn"
            >
              Send
            </button>
          </div>
        </section>
      )}
    </>
  )
}

ChatPanel.propTypes = {
  facts: PropTypes.arrayOf(PropTypes.shape({ path: PropTypes.string })),
  factByPath: PropTypes.object,
  scenarioValues: PropTypes.object,
  appLabel: PropTypes.string,
  headerBottom: PropTypes.number,
}

export default forwardRef(ChatPanel)

function ChatGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
