// Feature flags for Fact Explorer.
//
// This is the Fact Explorer half of a feature-flag system shared, by convention and
// naming, with the credit-assistant Scala app (see its `build/Flags.scala` +
// `--aiScenarioGeneration` / `--aiFactExplanation` build flags) and with
// taxpert's feature-flags.js. The same logical flag can be toggled in every
// app at once, and the localStorage key they all read/write is deliberately the
// same string, so a flag's name here must match its name there exactly.
//
// This module is read-only: the only UI that writes an override is the shared
// <taxpert-workspace-settings-modal> (taxpert, mounted once in App.jsx,
// opened from the global nav's settings gear). Fact Explorer used to have its own
// duplicate toggle (FeatureFlagPanel) but it's been removed in favor of that
// shared surface. See useFeatureFlags.js for how Fact Explorer resyncs when it fires.
//
// Two-layer resolution (highest wins):
//   1. Runtime override stored in localStorage ('taxpert:featureFlags')
//   2. Build-time env var (import.meta.env.VITE_*), the default when no override
//
// Components must never read import.meta.env directly for a flag. Always go
// through this module (or the useFeatureFlags hook) so runtime overrides apply.

import { FACT_EXPLORER_FLAGS } from './taxpertHost.js'

const LS_KEY = 'taxpert:featureFlags'
const truthy = (v) => v === 'true' || v === '1' || v === true

// Dispatched on `document` by taxpert's feature-flags.js setFlag(); see useFeatureFlags.js.
export const FLAG_CHANGE_EVENT = 'taxpert:feature-flags-changed'

// Build-time defaults resolved once at module load from Vite env vars.
//
// The env reads are spelled out rather than derived from a flag's name: Vite substitutes
// `import.meta.env.VITE_*` by static analysis, so a computed `import.meta.env[key]` silently
// resolves to undefined in a production build.
//
// What is NOT restated here is the flag list itself. That comes from FACT_EXPLORER_FLAGS, the one
// place Fact Explorer declares which features it has (it is also what registerFactExplorerHost()
// hands to taxpert). Before this, the names were typed out independently here and there, and
// nothing would have caught them drifting apart.
//
// Deliberately NOT imported from taxpert: per this app's CLAUDE.md the two modules stay
// separate because their build defaults come from genuinely different places: a Vite env var here,
// a DOM attribute on the panel element there. FACT_EXPLORER_FLAGS is Fact Explorer's own file, so
// single-sourcing through it keeps that rule intact.
const ENV_DEFAULTS = {
  aiScenarioGeneration: truthy(import.meta.env.VITE_AI_SCENARIO_GENERATION),
  aiFactExplanation: truthy(import.meta.env.VITE_AI_FACT_EXPLANATION),
}

const BUILD_DEFAULTS = Object.fromEntries(
  FACT_EXPLORER_FLAGS.map(({ name }) => [name, ENV_DEFAULTS[name] ?? false])
)

function readOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

// Returns the effective value for every known flag.
export function getAllFlags() {
  const overrides = readOverrides()
  const result = {}
  for (const key of Object.keys(BUILD_DEFAULTS)) {
    result[key] = key in overrides ? Boolean(overrides[key]) : BUILD_DEFAULTS[key]
  }
  return result
}

export const isAiScenarioGenerationEnabled = () => getAllFlags().aiScenarioGeneration
export const isAiFactExplanationEnabled = () => getAllFlags().aiFactExplanation
