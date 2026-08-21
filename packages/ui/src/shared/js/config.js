// The one place a host tells taxpert what application it is wrapping.
//
// This package ships the *workspace* — the nav, the audit panel, the three tool panels — and knows
// nothing about the application underneath it. Everything that used to be a literal in here (one
// host's fact paths, its deployed route prefix, its product name in the chat placeholder) is now
// something a host supplies by calling configure() once, before or after the element modules load.
//
// Three layers, and the default for each is decided by which layer it belongs to:
//
//   Fact Graph platform    graph.get(), `*` wildcards, `#id` items    → defaults match today
//   host flow markup       fg-set / fg-show / .twe-question           → defaults match today,
//                                                                        but declarative (flow-dom.js)
//   the application        determinations, menu, brand, endpoints     → default to EMPTY
//
// A host that supplies nothing gets a working-but-contentless workspace: no menu items, no
// determinations, the neutral copy in the templates. That is deliberate — an empty Outcome tracker
// is honest, whereas another application's permanently-unresolvable determinations are a lie.
//
// ── Read late, never capture ──────────────────────────────────────────────────────────────────
//
// Elements must call getConfig() *when they render*, not in connectedCallback and never at module
// scope. Three things depend on it:
//
//   • Ordering. credit-assistant's head.html loads the element modules and the config fragment as
//     separate <script type="module"> tags; whichever wins the race, read-late is correct.
//   • Re-configuration. fact-explorer switches data source at runtime and calls configure()
//     again. Captured config would go stale.
//   • It matches registerSection()'s existing tolerance for late registration.
//
// configure() dispatches CONFIG_CHANGE_EVENT on `document` so an already-rendered element can
// re-read. Elements that render from config should listen for it.
//
// ── Three layers ──────────────────────────────────────────────────────────────────────────────
//
//   defaults        this file                        what a host that says nothing gets
//   host            configure(), from the host page  the build's configuration
//   user overrides  localStorage                     what a person changed in Workspace settings
//
// Later wins, per key. The override layer is what makes the workspace editable without a code
// change: `getConfig()` re-derives the merged view whenever either layer moves, and because every
// element already reads late and listens for CONFIG_CHANGE_EVENT, nothing downstream needed a line
// of change to become configurable.
//
// The merged object's *identity is stable* — it is recomputed in place, never replaced — so a
// module that captured it (against the rule above) still sees the current values rather than a
// frozen snapshot.
//
// Overrides are validated before they are stored and again when they are read back, and a bad set
// is dropped whole. See config-schema.js for why all-or-nothing.

import { defaultFlowDom } from './flow-dom.js'
import { windowFactGraphAdapter } from './graph-adapter.js'
import { validateConfig } from './config-schema.js'

export const CONFIG_CHANGE_EVENT = 'taxpert:config-changed'

/**
 * The shape every namespace defaults to.
 *
 * `app.storagePrefix` namespaces every sessionStorage/localStorage key the workspace writes, so two
 * Form Builder apps served from the same origin, each under its own path prefix, do not share a watchlist
 * or a panel layout. It defaults to 'taxpert' — today's unprefixed-but-for-`taxpert:` spelling.
 */
function baseConfig () {
  return {
    app: {
      id: '',
      brand: 'Taxpert',
      storagePrefix: 'taxpert',
    },
    nav: {
      // Menu items, in the shape nav-menu-data.js documents. Empty until a host registers one.
      menu: [],
      // Destination ids where the nav's Tools button appears at all.
      toolsByDestination: [],
    },
    // The other applications this workspace can be pointed at, and which of them it is on now.
    // See apps.js. Empty for a host that is the only application there is — the Applications
    // section then has nothing to offer and hides itself.
    apps: {
      current: '',
      items: [],
    },
    endpoints: {
      // The chat/scenario-generation backend.
      apiBase: 'http://localhost:8000',
      // Directory scenario JSONs are served from, e.g. /resources/scenarios.
      scenariosBase: '',
      // Where the fact dictionary XML is fetched from, when a host serves one.
      factDictionaryUrl: '',
    },
    // Feature flags this host understands: { name: camelCase, kebab: kebab-case, label }.
    // `label` is the wording the Workspace settings modal shows on the flag's row — it renders one
    // row per entry here, so a host with no flags gets that modal's empty state rather than another
    // application's features.
    featureFlags: [],
    // Workspace tools, in canonical dock order. Defaults to the three platform tools — they are
    // part of the workspace, not part of any application.
    tools: null, // filled by defaultTools() below; `null` distinguishes "unset" from "empty".
    // Outcome tracker content. Empty ⇒ the tracker renders its empty state.
    determinations: [],
    // The fact-graph port. See graph-adapter.js.
    graph: null, // filled by windowFactGraphAdapter() below.
    // The host's flow-markup conventions. See flow-dom.js.
    flowDom: null, // filled by defaultFlowDom() below.
    // Host-overridable copy. Keys are read by the module that shows them; see each call site.
    strings: {},
  }
}

/**
 * The three tools the workspace itself provides. Platform, not application — every host gets them
 * unless it replaces the list. Descriptions are deliberately application-neutral; the Outcome
 * tracker's used to name one host's eligibility rules.
 */
function defaultTools () {
  return [
    {
      id: 'inspect',
      label: 'Inspect',
      description: 'Inspect facts, flows and text.',
      templateId: 'ttp-body-inspect',
    },
    {
      id: 'outcome-tracker',
      label: 'Outcome tracker',
      description: 'Track the outcomes this application determines.',
      templateId: 'ttp-body-outcome-tracker',
    },
    {
      id: 'watchlist',
      label: 'Watchlist',
      description: 'Track the value of one or more facts as you work or load scenarios.',
      templateId: 'ttp-body-watchlist',
    },
  ]
}

// The defaults + everything the host page has configure()d, accumulated. Not the public object.
let hostLayer = null
// The user's overrides, parsed from localStorage once and re-read when they change. `null` means
// "not looked at yet"; an empty object means "looked, and there are none".
let overrideLayer = null
// Which storage key `overrideLayer` was read from, so a host that sets its prefix after this module
// loaded gets its own record rather than the unprefixed one read a moment earlier.
let overrideKeyRead = null
// The public object. Its identity never changes once created; _apply() rewrites its contents.
let config = null

/** Build the fully-defaulted config, resolving the three lazily-defaulted namespaces. */
function _seed () {
  const seeded = baseConfig()
  seeded.tools = defaultTools()
  seeded.graph = windowFactGraphAdapter()
  seeded.flowDom = defaultFlowDom()
  return seeded
}

/**
 * The current configuration. Always fully populated — every namespace and every key exists, so a
 * caller never has to guard `config.nav?.menu`.
 *
 * READ THIS AT RENDER TIME. See the module comment.
 */
export function getConfig () {
  if (!config) {
    hostLayer = _seed()
    config = {}
    _apply()
  }
  return config
}

// Recompute the merged view into the existing `config` object. One pass per namespace, using the
// same merge rules configure() documents: plain objects merge key by key, arrays and functions
// replace outright.
function _apply () {
  const overrides = _overrides()
  for (const [key, hostValue] of Object.entries(hostLayer)) {
    const override = Object.hasOwn(overrides, key)
      ? Object.getOwnPropertyDescriptor(overrides, key)?.value
      : undefined
    _set(config, key, override === undefined ? hostValue : _merge(hostValue, override))
  }
}

function _merge (existing, incoming) {
  if (isPlainObject(incoming) && isPlainObject(existing)) return { ...existing, ...incoming }
  return incoming
}

/**
 * Merge `partial` into the configuration.
 *
 * Idempotent and re-callable: a second call merges on top of the first rather than replacing it,
 * so a host can set endpoints at page level and determinations from a per-page fragment. Objects
 * merge one level deep (namespace by namespace, key by key); arrays and functions *replace*, since
 * a half-merged menu or a merged `outcome()` is never what anyone means.
 *
 * @param {object} partial
 * @returns {object} the merged configuration
 */
export function configure (partial) {
  const current = getConfig()
  if (!partial || typeof partial !== 'object') return current

  // Entries rather than keys, and a descriptor rather than `hostLayer[key]`, so neither side is a
  // computed member access on a caller-supplied name. Unknown keys are ignored rather than written,
  // which also closes the prototype-pollution path.
  //
  // Writes land on the host layer, not on the merged object: a user's override must keep winning
  // over a host that configures again afterwards, which is the whole point of the ordering.
  for (const [key, incoming] of Object.entries(partial)) {
    if (!Object.hasOwn(hostLayer, key)) continue
    const existing = Object.getOwnPropertyDescriptor(hostLayer, key)?.value
    _set(hostLayer, key, _merge(existing, incoming))
  }

  _apply()
  _announce()
  return current
}

function _announce () {
  document.dispatchEvent(new CustomEvent(CONFIG_CHANGE_EVENT, { detail: { config } }))
}

/**
 * Configure from a JSON file the host serves — the per-deployment layer.
 *
 * A host page's configure() call is code: changing it means editing a template and rebuilding. This
 * is the same configuration as data, so a deployment can change what the workspace tracks, offers
 * or points at by editing one file that is reviewable in git — which localStorage never is.
 *
 * It lands *after* the host's own configure(), because it is fetched, and configure() merges — so a
 * deployment's file wins over the build's defaults, and a person's overrides still win over both.
 * That is the precedence the layering documents, arrived at by ordinary asynchrony rather than by a
 * fourth layer to keep in step.
 *
 * A missing file is not an error: most deployments override nothing. A file that is *present* and
 * wrong is, and says so loudly rather than half-applying.
 *
 * Translated copy does not belong here — the file is served once and is not per-locale. Anything a
 * person reads should stay in the host's own templating.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function configureFromUrl (url) {
  let partial
  try {
    const response = await fetch(url)
    if (!response.ok) return { ok: true, errors: [] } // nothing to apply
    partial = await response.json()
  } catch (error) {
    console.warn(`taxpert: could not read config from ${url} — ${error.message}`)
    return { ok: false, errors: [String(error.message)] }
  }

  const { ok, errors } = validateConfig(partial)
  if (!ok) {
    console.error(`taxpert: ignoring ${url} — ${errors.join('; ')}`)
    return { ok, errors }
  }

  configure(partial)
  return { ok: true, errors: [] }
}

// Writes go through a Map-free helper with an explicit own-key guard so the linter's
// detect-object-injection rule has something concrete to check. `key` is always one of the
// namespaces baseConfig() declares — configure() has already filtered it.
function _set (target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

function isPlainObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// ── The user override layer ───────────────────────────────────────────────────────────────────
//
// Everything below is what makes the configuration editable at runtime. It is the same shape as
// feature-flags.js — a localStorage record, a setter that dispatches, and a reset — because a flag
// is just the boolean special case of this, and there should be one pattern to learn.

/**
 * Where the overrides live.
 *
 * Derived from the *host* layer's prefix rather than through storageKey(), for two reasons. It
 * would otherwise recurse — storageKey() reads getConfig(), which is what is being built. And the
 * prefix decides where a person's overrides are kept, so an override that moved it would relocate
 * its own record and vanish on the next load; `app.storagePrefix` is stripped on read for the same
 * reason.
 */
function _overridesKey () {
  return `${hostLayer?.app?.storagePrefix || 'taxpert'}:configOverrides`
}

/**
 * Parse (once) and validate the stored overrides. An invalid set is dropped whole.
 *
 * Re-reads when the key itself moves, which it does exactly once on a normal page: this module is
 * imported before the host calls configure(), so the first read happens under the default prefix
 * and the host's own prefix arrives a moment later. Caching without that check would pin every
 * prefixed host to whatever the *unprefixed* record held.
 */
function _overrides () {
  const key = _overridesKey()
  if (overrideLayer && overrideKeyRead === key) return overrideLayer
  overrideKeyRead = key
  overrideLayer = {}

  let stored
  try {
    stored = JSON.parse(globalThis.localStorage?.getItem(_overridesKey()) ?? '{}')
  } catch {
    // Unparseable JSON — someone hand-edited it, or storage is unavailable. Nothing to salvage.
    return overrideLayer
  }
  if (!isPlainObject(stored)) return overrideLayer

  const { ok, errors } = validateConfig(stored)
  if (!ok) {
    console.warn(
      `taxpert: ignoring stored config overrides — ${errors.join('; ')}. ` +
        'Reset them in Workspace settings.'
    )
    return overrideLayer
  }

  if (isPlainObject(stored.app) && 'storagePrefix' in stored.app) {
    const { storagePrefix, ...rest } = stored.app
    _set(stored, 'app', rest)
    console.warn('taxpert: app.storagePrefix cannot be overridden; ignoring it')
  }

  overrideLayer = stored
  return overrideLayer
}

/**
 * The configuration *without* the user's overrides — what this build ships.
 *
 * Read-only, and the answer to every "what would this be if I reset it" question the editor asks:
 * which tools the build offers, what a determination said before it was edited. Shallow-copied so a
 * caller cannot write through it to the host layer.
 */
export function getBuildConfig () {
  getConfig()
  return { ...hostLayer }
}

/** The stored overrides, as a plain object. A copy — mutating it changes nothing. */
export function getConfigOverrides () {
  getConfig()
  return structuredClone(_overrides())
}

/** Whether `path` ('tools', 'app.brand') is currently overridden — what an editor's badge reads. */
export function isOverridden (path) {
  getConfig()
  const [namespace, key] = String(path).split('.')
  const overrides = _overrides()
  if (!Object.hasOwn(overrides, namespace)) return false
  if (!key) return true
  const value = Object.getOwnPropertyDescriptor(overrides, namespace)?.value
  return isPlainObject(value) && Object.hasOwn(value, key)
}

/**
 * Override one namespace, or one key inside one.
 *
 * @param {string} path 'tools' | 'app.brand' — one or two segments, because the configuration is
 *   two levels deep by design and a deeper path would be describing something else.
 * @param {*} value
 * @returns {{ ok: boolean, errors: string[] }} the validation result; nothing is stored when !ok,
 *   so a caller can put the errors in front of whoever typed them.
 */
export function setConfigOverride (path, value) {
  getConfig()
  const segments = String(path).split('.')
  if (segments.length > 2) {
    return { ok: false, errors: [`"${path}" is too deep — use "namespace" or "namespace.key"`] }
  }
  const [namespace, key] = segments
  if (!Object.hasOwn(hostLayer, namespace)) {
    return { ok: false, errors: [`unknown namespace "${namespace}"`] }
  }

  const next = structuredClone(_overrides())
  if (key) {
    const existing = Object.hasOwn(next, namespace)
      ? Object.getOwnPropertyDescriptor(next, namespace)?.value
      : {}
    _set(next, namespace, { ...(isPlainObject(existing) ? existing : {}), [key]: value })
  } else {
    _set(next, namespace, value)
  }

  return setConfigOverrides(next)
}

/**
 * Replace the whole override set — what Import pastes in, and what every other writer here funnels
 * through, so validation and persistence happen in exactly one place.
 */
export function setConfigOverrides (all) {
  getConfig()
  const { ok, errors } = validateConfig(all)
  if (!ok) return { ok, errors }

  try {
    globalThis.localStorage?.setItem(_overridesKey(), JSON.stringify(all))
  } catch {
    return { ok: false, errors: ['could not write to browser storage'] }
  }

  overrideLayer = null // re-read, so what is in effect is what was actually stored
  _apply()
  _announce()
  return { ok: true, errors: [] }
}

/** Drop the override on `path`, restoring the build's value. */
export function resetConfigOverride (path) {
  getConfig()
  const [namespace, key] = String(path).split('.')
  const next = structuredClone(_overrides())
  if (!Object.hasOwn(next, namespace)) return { ok: true, errors: [] }

  if (key) {
    const existing = Object.getOwnPropertyDescriptor(next, namespace)?.value
    if (isPlainObject(existing)) {
      const { [key]: _dropped, ...rest } = existing
      // An empty namespace is deleted rather than left as `{}`, so isOverridden('app') answers no
      // once its last key has been reset.
      if (Object.keys(rest).length) _set(next, namespace, rest)
      else delete next[namespace] // eslint-disable-line security/detect-object-injection
    }
  } else {
    delete next[namespace] // eslint-disable-line security/detect-object-injection
  }
  return setConfigOverrides(next)
}

/** Drop every override at once — the way back when a workspace has been edited into a corner. */
export function resetAllConfigOverrides () {
  return setConfigOverrides({})
}

/**
 * Drop back to defaults. A test seam, matching _resetWatchlist()/_resetTemplates() — production
 * code has no reason to un-configure a host.
 */
export function _resetConfig () {
  config = null
  hostLayer = null
  overrideLayer = null
  overrideKeyRead = null
}
