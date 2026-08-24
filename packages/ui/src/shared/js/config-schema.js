// The shape gate every stored configuration goes through: a person's localStorage overrides and a
// deployment's taxpert.config.json. A host's own configure() call is trusted code and is not
// checked.
//
// Validation is shape only, never semantics. Whether a fact path exists is the graph's business,
// and this module has no graph. It is also all-or-nothing, so a half-applied override cannot leave
// a workspace nobody can reproduce from either the file or the build.
//
// See ../../../../../docs/internals/workspace-configuration.md

import { OUTCOME_KINDS } from './outcome-kinds.js'

/** The namespaces configure() knows. Anything else is a typo or a stale key. */
const NAMESPACES = [
  'app', 'apps', 'nav', 'endpoints', 'featureFlags', 'tools', 'determinations', 'graph', 'flowDom',
  'strings',
]

/** Namespaces a stored config may not carry. `graph` is functions and cannot survive JSON. */
const CODE_ONLY = ['graph']

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0

/**
 * Check a config partial destined for storage.
 *
 * @param {object} partial
 * @param {object} [options]
 * @param {boolean} [options.allowCodeOnly] permit `graph`, for validating what a host passed to
 *   configure() directly. Off by default.
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

// One `if` per namespace rather than a lookup table, which would be a computed access on caller data.
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

// `outcome` may be absent, a descriptor, or a function. A function reaching storage is refused
// rather than dropped, since dropping it would silently change what a determination says.
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
    // `facts` is the Overrides tool's own content: the paths it offers a field for.
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

// `destinations` is checked like a menu, with an href each, since switching applications navigates.
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

// A menu is one level of groups over leaves. Recursing covers a group's children.
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
