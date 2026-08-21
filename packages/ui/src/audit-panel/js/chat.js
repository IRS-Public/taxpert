// Explain & Analyze chat. Ported from credit-assistant. Initialization is exported (initChat) so
// the panel can call it once its DOM is built rather than running at module-eval time.
//
// The backend base follows the same order fact-graph-io.js documents — panel attribute, then
// config.endpoints.apiBase — rather than a second copy of the default URL, which is what the two
// files used to disagree about the day one of them changed.
import { factDictionaryXml, makeCollectionIdPath } from './fact-dictionary.js'
import { getAuditPanelStorage } from './storage.js'
import { getConfig } from '../../shared/js/config.js'
import { storageKey } from '../../shared/js/storage-keys.js'

// Where the transcript is kept across page loads. A function, and invoked at each use: this module
// is imported before the host calls configure(), so a captured key would pin the default prefix.
// It was the unprefixed 'auditPanelChat' and is now '<prefix>:auditPanelChat' — one conversation is
// dropped on upgrade, the accepted one-time reset described in storage-keys.js.
const chatStorageKey = () => storageKey('auditPanelChat')

// ── Chat HTTP ─────────────────────────────────────────────────────────────────

const CHAT_TIMEOUT_MS = 90_000

// Read at call time: the panel is in the DOM by then, and the host may have configured since.
function _chatApiUrl () {
  const panel = document.querySelector('taxpert-audit-panel')
  const base = panel?.getAttribute('api-base') || getConfig().endpoints.apiBase
  return `${base}/chat`
}

// Bounds for the dependency-value tree we attach to each tracked fact. This mirrors
// Graph.debugFactRecurse() (resolve every dependency's current value) but stays
// bounded so we don't blow up the chat prompt for deeply-nested facts.
const FACT_TREE_MAX_DEPTH = 4
const FACT_TREE_MAX_NODES = 50

// Read the current value/completeness of a concrete fact path from the live graph. The port answers
// null for a path it has no opinion about; only `fact.get` can still throw.
function _factValue (concretePath) {
  try {
    const fact = getConfig().graph.get(concretePath)
    if (fact?.hasValue) {
      return { value: fact.get.toString(), complete: fact.complete }
    }
  } catch {}
  return { value: null, complete: false }
}

// The raw <Dependency> paths declared in a fact's dictionary definition.
function _factDependencyPaths (abstractPath) {
  const factDef = factDictionaryXml.querySelector(`Fact[path="${abstractPath}"]`)
  if (!factDef) return []
  return Array.from(factDef.querySelectorAll('Dependency'))
    .map((dep) => dep.getAttribute('path'))
    .filter(Boolean)
}

function _abstractOf (concretePath) {
  return concretePath.replace(/#[^/]+/g, '*')
}

function _collectionIdOf (concretePath) {
  const match = concretePath.match(/#([^/]+)/)
  return match ? match[1] : null
}

// Resolve a raw dependency path (which may be relative "../x" or contain a "*"
// collection wildcard) to a concrete path, mirroring ConditionDetail's resolution.
// Returns null when it can't be resolved to a concrete path (unresolved wildcard).
function _resolveDependencyConcrete (rawPath, parentAbstract, collectionId) {
  let abstractPath = rawPath.startsWith('..')
    ? rawPath.replace('..', parentAbstract.replace(/\*\/.*/, '*'))
    : rawPath
  if (abstractPath.includes('*')) {
    if (!collectionId) return null
    abstractPath = abstractPath.replace('*', `#${collectionId}`)
    if (abstractPath.includes('*')) return null
  }
  return abstractPath
}

// Recursively resolve a fact and its dependencies to current values, bounded by
// FACT_TREE_MAX_DEPTH/FACT_TREE_MAX_NODES. ``seen`` guards against cycles/repeats.
function _buildFactTree (concretePath, depth, counter, seen) {
  if (depth > FACT_TREE_MAX_DEPTH || counter.n >= FACT_TREE_MAX_NODES) return null
  if (seen.has(concretePath)) return { path: concretePath, repeated: true }
  seen.add(concretePath)
  counter.n++

  const { value, complete } = _factValue(concretePath)
  const node = { path: concretePath, value, complete }

  const abstractPath = _abstractOf(concretePath)
  const collectionId = _collectionIdOf(concretePath)
  const children = []
  for (const rawPath of _factDependencyPaths(abstractPath)) {
    if (counter.n >= FACT_TREE_MAX_NODES) break
    const depConcrete = _resolveDependencyConcrete(rawPath, abstractPath, collectionId)
    if (!depConcrete) continue
    const child = _buildFactTree(depConcrete, depth + 1, counter, seen)
    if (child) children.push(child)
  }
  if (children.length) node.dependencies = children
  return node
}

function _getTrackedFacts () {
  const trackedFacts = getAuditPanelStorage().trackedFacts || []
  return trackedFacts.map(({ path, collectionId }) => {
    const factPath = makeCollectionIdPath(path, collectionId)
    const { value, complete } = _factValue(factPath)
    // Attach the resolved dependency tree so the agent reasons over live values
    // instead of inventing them from static fact-dictionary structure.
    const tree = _buildFactTree(factPath, 0, { n: 0 }, new Set())
    return { path: factPath, value, complete, dependencies: tree?.dependencies ?? [] }
  })
}

function _escapeHtml (text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function _renderMarkdown (text) {
  const lines = text.split('\n')
  const output = []
  let i = 0

  while (i < lines.length) {
    // eslint-disable-next-line security/detect-object-injection
    const line = lines[i]

    // Fenced code block (```)
    if (line.trimStart().startsWith('```')) {
      const fenceLines = []
      i++
      // eslint-disable-next-line security/detect-object-injection
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        // eslint-disable-next-line security/detect-object-injection
        fenceLines.push(_escapeHtml(lines[i]))
        i++
      }
      output.push('<pre><code>' + fenceLines.join('\n') + '</code></pre>')
      i++ // skip closing fence
      continue
    }

    // ATX heading ## or ###
    const h3Match = line.match(/^##\s+(.+)$/)
    const h4Match = line.match(/^###\s+(.+)$/)
    if (h4Match) {
      output.push('<h4>' + _renderInline(h4Match[1]) + '</h4>')
      i++
      continue
    }
    if (h3Match) {
      output.push('<h3>' + _renderInline(h3Match[1]) + '</h3>')
      i++
      continue
    }

    // Unordered list block
    if (/^[-*]\s/.test(line)) {
      const items = []
      // eslint-disable-next-line security/detect-object-injection
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        // eslint-disable-next-line security/detect-object-injection
        items.push('<li>' + _renderInline(lines[i].replace(/^[-*]\s+/, '')) + '</li>')
        i++
      }
      output.push('<ul>' + items.join('') + '</ul>')
      continue
    }

    // Ordered list block
    if (/^\d+\.\s/.test(line)) {
      const items = []
      // eslint-disable-next-line security/detect-object-injection
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        // eslint-disable-next-line security/detect-object-injection
        items.push('<li>' + _renderInline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>')
        i++
      }
      output.push('<ol>' + items.join('') + '</ol>')
      continue
    }

    // Blank line → paragraph break
    if (line.trim() === '') {
      output.push('<br>')
      i++
      continue
    }

    // Normal paragraph line
    output.push(_renderInline(line) + '<br>')
    i++
  }

  // Trim trailing <br> tags
  let result = output.join('')
  result = result.replace(/(<br>)+$/, '')
  return result
}

function _renderInline (text) {
  // Escape HTML first, then apply inline markdown
  return _escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function _appendChatMessage (role, content) {
  const container = document.getElementById('chat-messages')
  if (!container) return
  const msg = document.createElement('div')
  msg.className = `chat-message chat-message--${role}`
  // A markdown renderer over LLM response text — output depends entirely on the response, so
  // there is no fixed markup to put in a template.
  // eslint-disable-next-line no-restricted-syntax
  msg.innerHTML = _renderMarkdown(content)
  container.appendChild(msg)
  container.scrollTop = container.scrollHeight
  // Persist to sessionStorage
  try {
    const history = JSON.parse(sessionStorage.getItem(chatStorageKey()) || '[]')
    history.push({ role, content })
    sessionStorage.setItem(chatStorageKey(), JSON.stringify(history))
  } catch (_) { /* storage full or unavailable */ }
}

function _setChatStatus (text) {
  const el = document.getElementById('chat-status')
  if (el) el.textContent = text
}

function _startThinkingAnimation () {
  const dots = ['', '.', '..', '...']
  let dotIdx = 0
  let elapsed = 0
  const id = setInterval(() => {
    elapsed++
    dotIdx = (dotIdx + 1) % dots.length
    // eslint-disable-next-line security/detect-object-injection
    _setChatStatus(`Thinking${dots[dotIdx]} (${elapsed}s)`)
  }, 1000)
  return () => clearInterval(id)
}

async function _sendChatMessage () {
  const textarea = document.querySelector('.chat-container__textarea')
  const prompt = textarea?.value.trim()
  if (!prompt) return

  _appendChatMessage('user', prompt)
  textarea.value = ''
  document.querySelector('.chat-container__submit-btn')?.setAttribute('disabled', 'true')
  _setChatStatus('Thinking…')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  const stopAnimation = _startThinkingAnimation()

  try {
    const res = await fetch(_chatApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, tracked_facts: _getTrackedFacts() }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      _setChatStatus(`Error: ${data.detail ?? res.statusText}`)
      return
    }

    const data = await res.json()
    _appendChatMessage('assistant', data.content)
    _setChatStatus('')
  } catch (err) {
    if (err.name === 'AbortError') {
      _setChatStatus('Request timed out — the backend took too long to respond.')
    } else {
      _setChatStatus(`Error: ${err.message ?? 'Request failed'}`)
    }
  } finally {
    clearTimeout(timeoutId)
    stopAnimation()
    document.querySelector('.chat-container__submit-btn')?.removeAttribute('disabled')
  }
}

/**
 * Wire the chat submit button + textarea and restore history from sessionStorage. Called from
 * the panel's enable() once the panel DOM exists (idempotent guard via a dataset flag).
 */
export function initChat () {
  const submitBtn = document.querySelector('#chat-submit-btn')
  const textarea = document.querySelector('.chat-container__textarea')
  if (!submitBtn || !textarea) return
  if (submitBtn.dataset.chatInitialized === 'true') return
  submitBtn.dataset.chatInitialized = 'true'

  submitBtn.addEventListener('click', _sendChatMessage)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      _sendChatMessage()
    }
  })

  // Restore chat history from sessionStorage
  const saved = sessionStorage.getItem(chatStorageKey())
  if (saved) {
    try {
      JSON.parse(saved).forEach(({ role, content }) => _appendChatMessage(role, content))
    } catch (_) { /* ignore corrupt storage */ }
  }
}
