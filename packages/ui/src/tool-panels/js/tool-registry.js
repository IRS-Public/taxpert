// The workspace tools the Tools modal offers and the dock lays out.
//
// The list is `config.tools` — three platform tools by default (see defaultTools() in config.js),
// replaceable wholesale by a host's configure() call and extendable one at a time by
// registerTool(). It used to be a const array here, which meant the package could only ever offer
// the tools it happened to ship with, and their descriptions had to name an application.
//
// Array position is the canonical order. A tool always lands in the same slot regardless of the
// order its checkbox was ticked, because every insertion is placed relative to this list rather
// than appended — see canonicalIndex() and tool-layout.js's insertDocked().
//
// `templateId` names the <template> holding the tool's body. The platform tools' templates ship as
// static stub markup in templates/tool-panel.html; because getTemplate(id) checks
// document.getElementById(id) first, a host can server-render a real one with the same id and it
// wins — that is the seam for filling a tool in without touching this bundle.
//
// Everything here is a function, not a const: the config is read when a caller asks, never captured
// at module scope. See the read-late note in config.js.

import { configure, getConfig } from '../../shared/js/config.js'

/** Every tool, in canonical order. */
export function tools () {
  return getConfig().tools
}

/** Every tool id, in canonical order. */
export function toolIds () {
  return tools().map((tool) => tool.id)
}

/**
 * Add `tool` to the list, or replace the entry with the same id in place.
 *
 * Replacing rather than appending a duplicate keeps this idempotent, which matters because a host
 * registers from a page fragment that may well run on every page of a flow — and because a tool
 * that moved position between two registrations would move its dock slot with it.
 */
export function registerTool (tool) {
  const next = tools().slice()
  const at = next.findIndex((existing) => existing.id === tool.id)
  if (at === -1) next.push(tool)
  else next.splice(at, 1, tool)
  configure({ tools: next })
  return next
}

/** The descriptor for `id`, or undefined. */
export function getTool (id) {
  return tools().find((tool) => tool.id === id)
}

/** A tool's position in the canonical order; -1 for an unknown id. */
export function canonicalIndex (id) {
  return toolIds().indexOf(id)
}

/** `ids` sorted back into canonical order, unknown ids dropped. */
export function inCanonicalOrder (ids) {
  return toolIds().filter((id) => ids.includes(id))
}
