// The workspace tool list: what the Tools modal offers and the dock lays out.
//
// The list is `config.tools`, seeded by defaultTools() in config.js and replaceable by a host.
// Array position is the canonical order; every insertion is placed against it rather than appended.
// Every export is a function so the config is read when a caller asks, never captured at module
// scope. See ../../../../../docs/internals/tool-panels.md.

import { configure, getConfig } from '../../shared/js/config.js'

/** Every tool, in canonical order. */
export function tools () {
  return getConfig().tools
}

/** Every tool id, in canonical order. */
export function toolIds () {
  return tools().map((tool) => tool.id)
}

/** Add `tool`, or replace the entry with the same id in place. Idempotent by design. */
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
