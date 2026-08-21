// What a configuration is allowed to say — the gate every *stored* override goes through.
//
// A host calling configure() from its own page is trusted code and is not validated: if it writes
// nonsense, its own build is broken and its own tests catch it. This exists for the two layers that
// are not code — a user's overrides in localStorage and a deployment's taxpert.config.json — where
// the input outlives the page that wrote it and arrives from outside the build.
//
// THE RULE IS ALL-OR-NOTHING. A half-applied override is worse than a rejected one: it leaves a
// workspace nobody can reproduce from the source tree, and the first symptom is a bug report about
// a feature that works fine for everyone else. So validateConfig() answers about the whole partial,
// and the loader drops the lot and warns rather than keeping the parts that happened to parse.
//
// It is deliberately shallow. It checks *shape* — is this a namespace we know, is this array an
// array of objects, is this outcome kind one that exists — and never semantics. Whether
// '/withholdingGap' is a real fact path is the graph's business and cannot be known here; a path
// that isn't shows up in the Outcome tracker as an unanswered row, which is the honest answer.
//
// Precedent: fact-explorer's validate() in src/model/fgm.js, which does the same job for the
// Form Builder Graph and for the same reason.

import { OUTCOME_KINDS } from './outcome-kinds.js'

/** The namespaces configure() knows. Anything else in a stored override is a typo or a stale key. */
const NAMESPACES = [
  'app', 'apps', 'nav', 'endpoints', 'featureFlags', 'tools', 'determinations', 'graph', 'flowDom',
  'strings',
]

/**
 * Namespaces a *stored* config may not carry, and why.
 *
 * `graph` is functions over a host's engine. It cannot survive JSON, and a null or half-built
 * adapter would take every tool on the page down with it — the tools call it on every `fg-update`.
 * It stays code, which is the one boundary this whole feature is drawn around.
 */
const CODE_ONLY = ['graph']

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

/**
 * Check a config partial destined for storage.
 *
 * @param {object} partial
 * @param {object} [options]
 * @param {boolean} [options.allowCodeOnly] permit `graph` — for validating what a host passed to
 *   configure() directly, where functions are legitimate. Off by default, because the callers that
 *   matter are the stored layers.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig (partial, { allowCodeOnly = false } = {}) {
  const errors = []

  if (!isPlainObject(partial)) {
    return { ok: false, errors: ['config must be an object'] }
  }

  for (const [key, value] of Object.entries(partial)) {
    if (!NAMESPACES.includes(key)) {
      errors.push(`unknown namespace "${key}"`)
      continue
    }
    if (!allowCodeOnly && CODE_ONLY.includes(key)) {
      errors.push(`"${key}" cannot be stored — it is functions over the host's engine`)
      continue
    }
    checkNamespace(key, value, errors)
  }

  return { ok: errors.length === 0, errors }
}

// One `if` per namespace rather than a table of validators keyed by name: the key would then be a
// computed lookup on caller data, and there are nine of them, not ninety.
function checkNamespace (key, value, errors) {
  if (key === 'determinations') return checkDeterminations(value, errors)
  if (key === 'tools') return checkTools(value, errors)
  if (key === 'featureFlags') return checkFeatureFlags(value, errors)
  if (key === 'nav') return checkNav(value, errors)
  if (key === 'apps') return checkApps(value, errors)
  if (key === 'app' || key === 'endpoints' || key === 'strings' || key === 'flowDom') {
    if (!isPlainObject(value)) errors.push(`"${key}" must be an object`)
  }
}

function checkList (value, key, errors) {
  if (!Array.isArray(value)) {
    errors.push(`"${key}" must be an array`)
    return false
  }
  return true
}

function checkDeterminations (value, errors) {
  if (!checkList(value, 'determinations', errors)) return

  value.forEach((determination, index) => {
    const at = `determinations[${index}]`
    if (!isPlainObject(determination)) return errors.push(`${at} must be an object`)
    if (!isNonEmptyString(determination.id)) errors.push(`${at}.id must be a non-empty string`)
    if (!isNonEmptyString(determination.label)) errors.push(`${at}.label must be a non-empty string`)
    if (!isNonEmptyString(determination.rollupPath)) {
      errors.push(`${at}.rollupPath must be a fact path`)
    }
    checkOutcome(determination.outcome, at, errors)

    if (!checkList(determination.sections ?? [], `${at}.sections`, errors)) return
    ;(determination.sections ?? []).forEach((section, sectionIndex) => {
      const sectionAt = `${at}.sections[${sectionIndex}]`
      if (!isPlainObject(section)) return errors.push(`${sectionAt} must be an object`)
      if (!isNonEmptyString(section.heading)) {
        errors.push(`${sectionAt}.heading must be a non-empty string`)
      }
      if (!checkList(section.facts, `${sectionAt}.facts`, errors)) return
      if (!section.facts.every(isNonEmptyString)) {
        errors.push(`${sectionAt}.facts must all be fact paths`)
      }
    })
  })
}

// `outcome` may be absent (the rollup speaks for itself), a descriptor, or — for a host that needs
// one — a function. A function reaching *storage* is the interesting case: it means someone tried
// to export or persist a config that had one, and silently dropping it would change what a
// determination says with nothing to point at.
function checkOutcome (outcome, at, errors) {
  if (outcome === undefined || outcome === null) return
  if (typeof outcome === 'function') {
    return errors.push(`${at}.outcome is a function, which cannot be stored — use a descriptor`)
  }
  if (!isPlainObject(outcome)) return errors.push(`${at}.outcome must be an object`)
  if (!OUTCOME_KINDS.includes(outcome.kind)) {
    errors.push(`${at}.outcome.kind must be one of: ${OUTCOME_KINDS.join(', ')}`)
    return
  }
  if (outcome.kind === 'map' && outcome.values !== undefined && !isPlainObject(outcome.values)) {
    errors.push(`${at}.outcome.values must be an object`)
  }
}

function checkTools (value, errors) {
  if (!checkList(value, 'tools', errors)) return
  value.forEach((tool, index) => {
    const at = `tools[${index}]`
    if (!isPlainObject(tool)) return errors.push(`${at} must be an object`)
    if (!isNonEmptyString(tool.id)) errors.push(`${at}.id must be a non-empty string`)
    if (!isNonEmptyString(tool.label)) errors.push(`${at}.label must be a non-empty string`)
    // Without a templateId the dock has no body to clone and the panel opens empty.
    if (!isNonEmptyString(tool.templateId)) errors.push(`${at}.templateId must name a <template>`)
    // A tool may carry its own content. `facts` is the Overrides tool's — the paths it offers a
    // field for — and is checked here rather than inside that tool so a bad list is refused at the
    // point it is stored, like everything else.
    if (tool.facts !== undefined) {
      if (!checkList(tool.facts, `${at}.facts`, errors)) return
      if (!tool.facts.every(isNonEmptyString)) errors.push(`${at}.facts must all be fact paths`)
    }
  })
}

function checkFeatureFlags (value, errors) {
  if (!checkList(value, 'featureFlags', errors)) return
  value.forEach((flag, index) => {
    const at = `featureFlags[${index}]`
    if (!isPlainObject(flag)) return errors.push(`${at} must be an object`)
    if (!isNonEmptyString(flag.name)) errors.push(`${at}.name must be a camelCase flag name`)
    if (!isNonEmptyString(flag.kebab)) errors.push(`${at}.kebab must be a kebab-case flag name`)
  })
}

// The applications this workspace can be switched between. `destinations` is checked like a menu
// because it is one — the same ids, per application — but with an href each, since switching is a
// navigation and a destination with no URL is a row that does nothing when clicked.
function checkApps (value, errors) {
  if (!isPlainObject(value)) return errors.push('"apps" must be an object')
  if (value.current !== undefined && typeof value.current !== 'string') {
    errors.push('"apps.current" must be an application id')
  }
  if (value.items === undefined) return
  if (!checkList(value.items, 'apps.items', errors)) return

  value.items.forEach((app, index) => {
    const at = `apps.items[${index}]`
    if (!isPlainObject(app)) return errors.push(`${at} must be an object`)
    if (!isNonEmptyString(app.id)) errors.push(`${at}.id must be a non-empty string`)
    if (!isNonEmptyString(app.label)) errors.push(`${at}.label must be a non-empty string`)
    if (app.destinations === undefined) return
    if (!checkList(app.destinations, `${at}.destinations`, errors)) return
    app.destinations.forEach((destination, destinationIndex) => {
      const destinationAt = `${at}.destinations[${destinationIndex}]`
      if (!isPlainObject(destination)) return errors.push(`${destinationAt} must be an object`)
      if (!isNonEmptyString(destination.id)) {
        errors.push(`${destinationAt}.id must be a nav destination id`)
      }
      if (!isNonEmptyString(destination.href)) {
        errors.push(`${destinationAt}.href must be a URL`)
      }
    })
  })
}

function checkNav (value, errors) {
  if (!isPlainObject(value)) return errors.push('"nav" must be an object')
  if (value.menu !== undefined && checkList(value.menu, 'nav.menu', errors)) {
    checkMenuItems(value.menu, 'nav.menu', errors)
  }
  if (value.toolsByDestination !== undefined &&
      checkList(value.toolsByDestination, 'nav.toolsByDestination', errors)) {
    value.toolsByDestination.forEach((tool, index) => {
      const at = `nav.toolsByDestination[${index}]`
      if (!isPlainObject(tool)) return errors.push(`${at} must be an object`)
      if (!isNonEmptyString(tool.id)) errors.push(`${at}.id must be a non-empty string`)
      if (tool.destinations !== undefined && !Array.isArray(tool.destinations)) {
        errors.push(`${at}.destinations must be an array of menu item ids`)
      }
    })
  }
}

// A menu is one level of groups over leaves; recursing handles the group's children without a
// second shape to describe.
function checkMenuItems (items, path, errors) {
  items.forEach((item, index) => {
    const at = `${path}[${index}]`
    if (!isPlainObject(item)) return errors.push(`${at} must be an object`)
    if (!isNonEmptyString(item.id)) errors.push(`${at}.id must be a non-empty string`)
    if (!isNonEmptyString(item.label)) errors.push(`${at}.label must be a non-empty string`)
    if (item.children !== undefined && checkList(item.children, `${at}.children`, errors)) {
      checkMenuItems(item.children, `${at}.children`, errors)
    }
  })
}
