// The three-layer configuration a host uses to say what application the workspace is wrapping.
// Later layer wins per key: this file's defaults, the host's configure() calls, then the person's
// overrides in localStorage.
//
// Two invariants callers rely on. getConfig() always answers a fully populated object, so nothing
// downstream writes `config.nav?.menu ?? []`. And that object keeps a stable identity for the life
// of the page, because _apply() rewrites its contents in place. The cost of the second is that
// elements must read getConfig() at render time rather than capturing values at module scope.
//
// See ../../../../../docs/internals/workspace-configuration.md

import { defaultFlowDom } from './flow-dom.js'
import { windowFactGraphAdapter } from './graph-adapter.js'
import { validateConfig } from './config-schema.js'

export const CONFIG_CHANGE_EVENT = 'taxpert:config-changed'

/** The shape every namespace defaults to. */
function baseConfig () {
  return {
    app: {
      id: '',
      brand: 'Taxpert',
      storagePrefix: 'taxpert',
    },
    nav: {
      menu: [],
      toolsByDestination: [],
    },
    apps: {
      current: '',
      items: [],
    },
    endpoints: {
      apiBase: 'http://localhost:8000',
      scenariosBase: '',
      factDictionaryUrl: '',
    },
    featureFlags: [],
    // The three lazily-defaulted namespaces. `null` distinguishes "unset" from "configured empty",
    // which for `tools` is the difference between the three defaults and none. _seed() fills them.
    tools: null,
    determinations: [],
    graph: null,
    flowDom: null,
    strings: {},
  }
}

/** The three tools the workspace itself provides, whatever application it is over. */
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

let hostLayer = null // defaults plus everything the host configure()d. Not the public object.
let overrideLayer = null // parsed localStorage overrides. `null` is unread, `{}` is read-and-empty.
let overrideKeyRead = null // which key overrideLayer came from, so a later prefix re-reads.
let config = null // the public object. Identity is stable; _apply() rewrites its contents.

/** Build the fully-defaulted config, resolving the three lazily-defaulted namespaces. */
function _seed () {
  const seeded = baseConfig()
  seeded.tools = defaultTools()
  seeded.graph = windowFactGraphAdapter()
  seeded.flowDom = defaultFlowDom()
  return seeded
}

/** The current configuration, always fully populated. Read it at render time, never at module scope. */
export function getConfig () {
  if (!config) {
    hostLayer = _seed()
    config = {}
    _apply()
  }
  return config
}

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
 * Merge `partial` into the configuration, one level deep per namespace. Idempotent and re-callable.
 * Objects merge key by key, arrays and functions replace outright.
 *
 * Writes land on the host layer rather than the merged object, so a person's override keeps winning
 * over a host that configures again afterwards. Unknown keys are ignored, which also closes the
 * prototype-pollution path.
 *
 * @param {object} partial
 * @returns {object} the merged configuration
 */
export function configure (partial) {
  const current = getConfig()
  if (!partial || typeof partial !== 'object') return current

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
 * Configure from a JSON file the host serves, the per-deployment layer.
 *
 * Being fetched, it lands after the host's synchronous configure(), so a deployment's file wins over
 * the build's values and a person's overrides still win over both. A missing file is not an error.
 * A present but invalid one is refused whole. Translated copy does not belong here, because the file
 * is served once and is not per-locale.
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

// defineProperty rather than `target[key] = value`, to satisfy detect-object-injection. Callers
// have already filtered `key` down to a namespace baseConfig() declares.
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

/**
 * Where the overrides live. Read off the host layer rather than through storageKey(), which would
 * recurse, because storageKey() reads the getConfig() this is building.
 */
function _overridesKey () {
  return `${hostLayer?.app?.storagePrefix || 'taxpert'}:configOverrides`
}

/**
 * Parse (once) and validate the stored overrides. An invalid set is dropped whole.
 *
 * Re-reads when the key itself moves, which happens once on a normal page, because this module is
 * imported before the host calls configure() and so the first read runs under the default prefix.
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
    return overrideLayer // hand-edited JSON, or storage unavailable. Nothing to salvage.
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

  // An override that could relocate its own record would be unreachable on the next load.
  if (isPlainObject(stored.app) && 'storagePrefix' in stored.app) {
    const { storagePrefix, ...rest } = stored.app
    _set(stored, 'app', rest)
    console.warn('taxpert: app.storagePrefix cannot be overridden; ignoring it')
  }

  overrideLayer = stored
  return overrideLayer
}

/**
 * What this build ships, without the person's overrides. Shallow-copied, so a caller cannot write
 * through to the host layer. The settings editor shows it as what a field would revert to.
 */
export function getBuildConfig () {
  getConfig()
  return { ...hostLayer }
}

/** The stored overrides, as a plain object. A copy; mutating it changes nothing. */
export function getConfigOverrides () {
  getConfig()
  return structuredClone(_overrides())
}

/** Whether `path` ('tools', 'app.brand') is currently overridden. Drives the editor's badges. */
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
 * @param {string} path 'tools' or 'app.brand'. One or two segments, the configuration being two
 *   levels deep.
 * @param {*} value
 * @returns {{ ok: boolean, errors: string[] }} nothing is stored when !ok, so a caller can show
 *   the errors to whoever typed them.
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

/** Replace the whole override set. Every other writer funnels through here, so validation and
 * persistence happen in one place. */
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
      // Deleted rather than left as `{}`, so isOverridden() answers no once the last key is reset.
      if (Object.keys(rest).length) _set(next, namespace, rest)
      else delete next[namespace] // eslint-disable-line security/detect-object-injection
    }
  } else {
    delete next[namespace] // eslint-disable-line security/detect-object-injection
  }
  return setConfigOverrides(next)
}

/** Drop every override at once. */
export function resetAllConfigOverrides () {
  return setConfigOverrides({})
}

/** Drop back to defaults. A test seam, matching _resetWatchlist() and _resetTemplates(). */
export function _resetConfig () {
  config = null
  hostLayer = null
  overrideLayer = null
  overrideKeyRead = null
}
