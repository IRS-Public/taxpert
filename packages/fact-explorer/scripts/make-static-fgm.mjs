// scripts/make-static-fgm.mjs — S1 node-gen for the Form Graph Model.
//
// Interim generator: parses a Form Builder app's real Flow XML and Fact Dictionary XML with
// fast-xml-parser and emits the full FGM JSON to public/data/<app>/form-builder-graph.json (the
// "local" source — see src/model/load.js).
//
// Which apps it generates comes from the same descriptors everything else reads: every
// fact-explorer.app.json under the apps directory (FORM_BUILDER_APPS_DIR, else <repo root>/apps —
// see apps/README.md). It is intentionally outside the Vite app and has no runtime dependency on it.
//
//   node scripts/make-static-fgm.mjs              every app  (or: npm run make-fgm)
//   node scripts/make-static-fgm.mjs --app twe    just one
//   FORM_BUILDER_APPS_DIR=~/code npm run make-fgm
//   then set VITE_FGM_SOURCE=real in .env.local and `npm run dev`.
//
// The emitted JSON satisfies the same validate() contract in src/model/fgm.js that the
// hand-authored mock fixture does — including its flow-tag allow-list, which is why an app that
// registers its own node types must declare them as `customFlowTags` in its descriptor.
//
// This is still the bridge ahead of the Scala generator (--formBuilderGraph), which emits the same
// shape from the parser that actually builds the site. When an app serves that file, load.js
// prefers it and this output becomes the offline fallback.

import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename as fileBase } from 'node:path'
import { scenarioVocabulary } from '../src/model/scenarios/index.js'
import { appsDir, discoverDescriptors, buildRegistryFile } from './build-registry.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FACT_EXPLORER = resolve(__dirname, '..')
// Where the app repos are: FORM_BUILDER_APPS_DIR, else <repo root>/apps. Shared with
// build-registry.mjs and vite.config.js so all three scan the same directory.
const APPS = appsDir()

const BUILT_IN_FLOW_TAGS = ['fg-set', 'fg-alert', 'fg-collection', 'fg-detail']

/**
 * The app currently being generated. Module-level rather than threaded through every parse
 * function: apps are generated strictly one after another, and `edgeCounter` below already
 * establishes that shape. `configure()` resets both — a leaked counter would collide edge ids
 * across apps.
 */
let cfg = null

/** Resolve one fact-explorer.app.json descriptor into everything this script needs. */
function configure(descriptor) {
  const repoDir = descriptor.repoDir
  const resources = join(repoDir, descriptor.resourceRoot ?? 'src/main/resources', descriptor.appId)
  cfg = {
    id: descriptor.id,
    label: descriptor.label ?? descriptor.id,
    basePath: descriptor.basePath,
    factsDir: join(resources, 'facts'),
    flowDir: join(resources, 'flow'),
    scenariosDir: descriptor.scenarios
      ? join(resources, descriptor.scenarios.dir ?? 'scenarios')
      : null,
    scenarioVocabulary: descriptor.scenarios?.vocabulary ?? null,
    taxYear: descriptor.taxYear ?? 2025,
    pagePrefixes: descriptor.pagePrefixes ?? {},
    customFlowTags: descriptor.customFlowTags ?? [],
    flowTags: new Set([...BUILT_IN_FLOW_TAGS, ...(descriptor.customFlowTags ?? [])]),
    outDir: join(FACT_EXPLORER, 'public', 'data', descriptor.id),
  }
  edgeCounter = 0
  return cfg
}

// ---------------------------------------------------------------------------
// Parser + preserve-order tree helpers
// ---------------------------------------------------------------------------
const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: '',
  attributesGroupName: ':@',
  textNodeName: '#text',
  trimValues: true,
})

// Round-trips a preserveOrder node back to an XML string. This is what powers
// the M4 explain popup: each <Fact> and flow element carries its own source
// XML, so fact-explorer can render the audit-panel derivation view without a Scala
// build (the Scala generator takes this over Post-MVP / P1).
const builder = new XMLBuilder({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: '',
  attributesGroupName: ':@',
  textNodeName: '#text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
})
const serializeXml = (node) => builder.build([node]).replace(/\s+$/, '')

const isText = (n) => '#text' in n
const TAG = (n) => Object.keys(n).find((k) => k !== ':@')
const ATTR = (n) => n[':@'] ?? {}
const KIDS = (n) => n[TAG(n)] ?? []
const childByTag = (kids, tag) => kids.find((c) => !isText(c) && TAG(c) === tag)
const firstElementName = (kids) => {
  const el = kids.find((c) => !isText(c))
  return el ? TAG(el) : null
}

/**
 * Concatenate all descendant text, skipping <fg-show/>. Pieces are space-joined
 * (then whitespace-collapsed) so that an inline <fg-show/> between two words —
 * each trimmed by the parser — doesn't glue them into "yourtaxes".
 */
function textOf(kids) {
  const parts = []
  for (const c of kids) {
    if (isText(c)) parts.push(String(c['#text']))
    else if (TAG(c) !== 'fg-show') parts.push(textOf(KIDS(c)))
    else parts.push(' ') // fg-show placeholder preserves word spacing
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Collect every <fg-show path="..."> path under these children, in order. */
function fgShowsIn(kids, acc = []) {
  for (const c of kids) {
    if (isText(c)) continue
    if (TAG(c) === 'fg-show') {
      const p = ATTR(c).path
      if (p) acc.push(p)
    } else fgShowsIn(KIDS(c), acc)
  }
  return acc
}

/** Collect conditional <span condition=... operator=...>text</span> entries. */
function spansIn(kids, acc = []) {
  for (const c of kids) {
    if (isText(c)) continue
    if (TAG(c) === 'span' && ATTR(c).condition) {
      acc.push({
        conditionPath: ATTR(c).condition,
        operator: ATTR(c).operator ?? null,
        text: textOf(KIDS(c)),
      })
    } else if (TAG(c) !== 'fg-show') spansIn(KIDS(c), acc)
  }
  return acc
}

// ---------------------------------------------------------------------------
// Fact-path helpers
// ---------------------------------------------------------------------------
function factBasename(p) {
  if (!p) return 'unknown'
  const segs = p.split('/').filter(Boolean)
  return segs[segs.length - 1] ?? 'unknown'
}

function slug(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Resolve a (possibly relative) Dependency path against the owning fact path.
 * The fact's own path is treated as the current directory, so `..` first pops
 * the fact's own name — e.g. `../livedWithYouUS` on
 * `/familyAndHousehold/{item}/isEitcQualifyingChild` -> `/familyAndHousehold/{item}/livedWithYouUS`
 * (where `{item}` denotes the collection-item wildcard).
 */
function resolvePath(raw, factPath) {
  if (raw.startsWith('/')) return raw
  const segs = factPath.split('/').filter(Boolean)
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segs.pop()
    else segs.push(part)
  }
  return '/' + segs.join('/')
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------
const BOOL_OPS = new Set([
  'All',
  'Any',
  'Not',
  'And',
  'Or',
  'Equal',
  'GreaterThan',
  'GreaterThanOrEqual',
  'LessThan',
  'LessThanOrEqual',
  'IsComplete',
  'IsIncomplete',
  'True',
  'False',
])
const VALUE_TYPES = {
  Dollar: 'Dollar',
  Int: 'Int',
  Rational: 'Rational',
  String: 'String',
  Enum: 'Enum',
  Boolean: 'Boolean',
  Date: 'Date',
}

function inferDerivedType(rootOp, derivedKids) {
  if (!rootOp) return null
  if (BOOL_OPS.has(rootOp)) return 'Boolean'
  if (rootOp === 'Count') return 'Int'
  if (rootOp === 'EnumOptions') return 'EnumOptions'
  if (rootOp === 'Switch') {
    const sw = derivedKids.find((c) => !isText(c))
    const cases = KIDS(sw).filter((c) => !isText(c) && TAG(c) === 'Case')
    for (const c of cases) {
      const then = childByTag(KIDS(c), 'Then')
      if (then) {
        const n = firstElementName(KIDS(then))
        if (n && n !== 'Dependency') return VALUE_TYPES[n] ?? n
      }
    }
    return null
  }
  return VALUE_TYPES[rootOp] ?? rootOp
}

function collectDeps(derivedNode, factPath) {
  const raws = []
  ;(function walk(kids) {
    for (const c of kids) {
      if (isText(c)) continue
      if (TAG(c) === 'Dependency') {
        const p = ATTR(c).path
        if (p) raws.push(p)
      } else walk(KIDS(c))
    }
  })(KIDS(derivedNode))

  const seen = new Set()
  const out = []
  for (const raw of raws) {
    if (seen.has(raw)) continue
    seen.add(raw)
    const resolvedAbstract = resolvePath(raw, factPath)
    out.push({ raw, resolvedAbstract, wildcard: resolvedAbstract.includes('*') })
  }
  return out
}

/** Parse one facts/*.xml file into the path->fact map (last write wins). */
function parseFactsFile(file, fileName, factsByPath) {
  const tree = parser.parse(readFileSync(file, 'utf8'))
  const root = tree.find((n) => !isText(n) && TAG(n) === 'FactDictionaryModule')
  if (!root) return
  const factsWrap = childByTag(KIDS(root), 'Facts')
  if (!factsWrap) return

  for (const node of KIDS(factsWrap)) {
    if (isText(node) || TAG(node) !== 'Fact') continue
    const path = ATTR(node).path
    if (!path) continue
    const kids = KIDS(node)

    const grab = (tag) => {
      const el = childByTag(kids, tag)
      const t = el ? textOf(KIDS(el)) : ''
      return t || null
    }

    const writable = childByTag(kids, 'Writable')
    const derived = childByTag(kids, 'Derived')

    let kind = 'derived'
    let typeNode = null
    let rootOp = null
    let dependencyPaths = []

    if (writable) {
      kind = 'writable'
      typeNode = firstElementName(KIDS(writable))
    } else if (derived) {
      kind = 'derived'
      const dkids = KIDS(derived)
      rootOp = firstElementName(dkids)
      typeNode = inferDerivedType(rootOp, dkids)
      dependencyPaths = collectDeps(derived, path)
    }

    const taxYearText = grab('TaxYear')

    factsByPath.set(path, {
      id: `fact:${path}`,
      path,
      name: grab('Name'),
      description: grab('Description'),
      kind,
      typeNode,
      sourceFile: fileName,
      taxYear: taxYearText ? Number(taxYearText) : null,
      dependencyPaths,
      rawXml: serializeXml(node), // drives the M4 explain popup
      __rootOp: rootOp, // internal; stripped before emit
    })
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------
// Node ids read as `<page-prefix>:<tag>:<factBasename>`, so the prefix is cosmetic but stable —
// an app may shorten its routes in fact-explorer.app.json (`pagePrefixes`). Everything unlisted falls
// back to a slug of the route; '/' becomes 'root' rather than any particular app's first page.
function pagePrefix(route) {
  if (cfg.pagePrefixes[route]) return cfg.pagePrefixes[route]
  return slug(route.replace(/^\//, '')) || 'root'
}

let edgeCounter = 0
const edgeId = (k) => `e-${k}-${++edgeCounter}`

function makeFlowElement(tag, node, ctx, usedIds) {
  const a = ATTR(node)
  const kids = KIDS(node)
  const gate = a['if-true']
    ? { kind: 'if-true', factPath: a['if-true'] }
    : a['if-false']
      ? { kind: 'if-false', factPath: a['if-false'] }
      : null

  const el = {
    id: '',
    pageId: ctx.pageId,
    tag,
    parentId: ctx.parentId,
    order: ctx.order,
    factPath: null,
    inputType: null,
    optionsPath: null,
    gate,
    condition: null,
    alert: null,
    collection: null,
    state: null,
    questionText: null,
    headingText: null,
    fgShowPaths: [],
    modalLinkId: null,
    conditionalSpans: [],
    rawXml: serializeXml(node), // drives the M4 flow detail panel
  }

  if (tag === 'fg-set') {
    el.factPath = a.path ?? null
    const input = childByTag(kids, 'input')
    if (input) {
      el.inputType = ATTR(input).type ?? null
      el.optionsPath = ATTR(input)['options-path'] ?? null
    }
    const q = childByTag(kids, 'question')
    if (q) {
      el.questionText = textOf(KIDS(q))
      el.fgShowPaths = fgShowsIn(KIDS(q))
      el.conditionalSpans = spansIn(KIDS(q))
    }
    const ml = childByTag(kids, 'modal-link')
    if (ml) el.modalLinkId = ATTR(ml).for ?? null
    el.id = unique(`${ctx.prefix}:fg-set:${factBasename(a.path)}`, usedIds)
  } else if (tag === 'fg-alert') {
    el.alert = {
      alertType: a['alert-type'] ?? null,
      alertKey: a['alert-key'] ?? null,
      knockout: a.knockout === 'true',
    }
    el.condition = { factPath: a.condition ?? null, operator: a.operator ?? null }
    const h = childByTag(kids, 'heading')
    if (h) el.headingText = textOf(KIDS(h))
    el.id = unique(`${ctx.prefix}:fg-alert:${a['alert-key'] ?? 'alert'}`, usedIds)
  } else if (tag === 'fg-collection') {
    el.factPath = a.path ?? null
    el.collection = {
      itemName: a['item-name'] ?? null,
      determiner: a['determiner'] ?? null,
      addItemIfTrue: a['add-item-if-true'] ?? null,
    }
    el.id = unique(`${ctx.prefix}:fg-collection:${factBasename(a.path)}`, usedIds)
  } else if (tag === 'fg-detail') {
    const s = childByTag(kids, 'summary')
    if (s) {
      el.headingText = textOf(KIDS(s))
      el.fgShowPaths = fgShowsIn(KIDS(s))
    }
    el.id = unique(`${ctx.prefix}:fg-detail:${slug(el.headingText) || 'detail'}`, usedIds)
  } else {
    // An app-registered node type (FormBuilderApp.nodeTypes), declared in its fact-explorer.app.json as a
    // customFlowTag. The scaffold cannot know what such an element means, so read only the vocabulary
    // every flow node shares — a bound fact path, a gate, a condition — and keep the rest verbatim in
    // `attrs` for the detail panel. Better a labelled box on the canvas with its real XML behind it
    // than an element silently dropped, which is what happened before this branch existed.
    el.factPath = a.path ?? null
    if (a.condition) el.condition = { factPath: a.condition, operator: a.operator ?? null }
    const known = new Set(['path', 'condition', 'operator', 'if-true', 'if-false'])
    const attrs = Object.fromEntries(Object.entries(a).filter(([k]) => !known.has(k)))
    if (Object.keys(attrs).length) el.attrs = attrs
    const label = factBasename(a.path) || slug(textOf(kids)) || 'node'
    el.id = unique(`${ctx.prefix}:${tag}:${label}`, usedIds)
  }
  return el
}

function unique(base, usedIds) {
  let id = base
  let i = 2
  while (usedIds.has(id)) id = `${base}-${i++}`
  usedIds.add(id)
  return id
}

/** Emit binds/gates/knocks-out/shows/displays edges for one flow element. */
function emitElementEdges(el, edges, factsByPath) {
  const has = (p) => p && factsByPath.has(p)
  const fid = (p) => `fact:${p}`

  if ((el.tag === 'fg-set' || el.tag === 'fg-collection') && has(el.factPath))
    edges.push({ id: edgeId('bind'), source: el.id, target: fid(el.factPath), kind: 'binds' })

  if (el.gate && has(el.gate.factPath))
    edges.push({
      id: edgeId('gate'),
      source: el.id,
      target: fid(el.gate.factPath),
      kind: 'gates',
      operator: el.gate.kind,
    })

  if (el.collection?.addItemIfTrue && has(el.collection.addItemIfTrue))
    edges.push({
      id: edgeId('gate'),
      source: el.id,
      target: fid(el.collection.addItemIfTrue),
      kind: 'gates',
      operator: 'add-item-if-true',
    })

  if (el.tag === 'fg-alert' && has(el.condition?.factPath)) {
    const kind = el.alert?.knockout ? 'knocks-out' : 'shows'
    const e = {
      id: edgeId(kind === 'knocks-out' ? 'ko' : 'show'),
      source: el.id,
      target: fid(el.condition.factPath),
      kind,
    }
    if (el.condition.operator) e.operator = el.condition.operator
    edges.push(e)
  }

  for (const p of el.fgShowPaths)
    if (has(p)) edges.push({ id: edgeId('disp'), source: el.id, target: fid(p), kind: 'displays' })
}

/** Parse one flow/*.xml module into pages/elements/edges. */
function parseFlowFile(file, out, factsByPath) {
  const tree = parser.parse(readFileSync(file, 'utf8'))
  const root = tree.find((n) => !isText(n) && TAG(n) === 'FlowConfig')
  if (!root) return
  const sourceFile = fileBase(file)

  for (const pageNode of KIDS(root)) {
    if (isText(pageNode) || TAG(pageNode) !== 'page') continue
    const a = ATTR(pageNode)
    const route = a.route
    const title = a.title
    const prefix = pagePrefix(route)
    const pageId = `page:${prefix}`

    const elementIds = []
    const usedIds = out.usedIds
    // doc-order siblings sharing the same flow parent (page root = '__root')
    const groups = new Map()
    let order = 0

    const walk = (kids, flowParentId) => {
      for (const child of kids) {
        if (isText(child)) continue
        const t = TAG(child)
        if (cfg.flowTags.has(t)) {
          const el = makeFlowElement(
            t,
            child,
            { pageId, prefix, parentId: flowParentId, order: order++ },
            usedIds
          )
          out.flowElements.push(el)
          elementIds.push(el.id)
          emitElementEdges(el, out.edges, factsByPath)
          const key = flowParentId ?? '__root'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(el)
          if (t === 'fg-collection' || t === 'fg-detail') walk(KIDS(child), el.id)
        } else {
          // descend through non-flow containers (section, div, ...) keeping the
          // same flow parent so siblings split by markup still chain in order.
          walk(KIDS(child), flowParentId)
        }
      }
    }
    walk(KIDS(pageNode), null)

    // Chain the user's progression through the page. A `sequential` edge only
    // links consecutive *advancing* steps (fg-set/fg-collection/fg-detail) so it
    // traces the happy path. An fg-alert is an off-ramp: it dangles off the step
    // whose answer triggers it via an `exits` edge, signalling the user fell out
    // of the flow (error/knockout) and can't proceed — it never advances the
    // chain, so the next question still links sequentially to the prior step.
    for (const els of groups.values()) {
      let prevStepId = null
      for (const el of els) {
        if (el.tag === 'fg-alert') {
          if (prevStepId)
            out.edges.push({ id: edgeId('exit'), source: prevStepId, target: el.id, kind: 'exits' })
        } else {
          if (prevStepId)
            out.edges.push({
              id: edgeId('seq'),
              source: prevStepId,
              target: el.id,
              kind: 'sequential',
            })
          prevStepId = el.id
        }
      }
    }

    out.flowPages.push({ id: pageId, route, title, sourceFile, elementIds })
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function generateApp(descriptor) {
  configure(descriptor)

  // 1. Facts — load alphabetically, last definition wins on duplicate path
  //    (mirrors the Scala loader). Exclude year-specific
  //    constants202X.xml files; use only constants.xml.
  const factsByPath = new Map()
  const factFiles = readdirSync(cfg.factsDir)
    .filter((f) => f.endsWith('.xml') && !/constants20\d\d\.xml/.test(f))
    .sort()
  for (const f of factFiles) parseFactsFile(join(cfg.factsDir, f), f, factsByPath)

  // 2. Flow — parse modules in the order index.xml declares them.
  const out = { flowPages: [], flowElements: [], edges: [], usedIds: new Set() }
  const flowModules = readModuleOrder()
  for (const f of flowModules) parseFlowFile(join(cfg.flowDir, f), out, factsByPath)

  // 3. Depends edges (fact -> fact). via = the source fact's root operation.
  const facts = [...factsByPath.values()]
  for (const f of facts) {
    for (const dep of f.dependencyPaths) {
      if (!factsByPath.has(dep.resolvedAbstract)) continue
      const e = {
        id: edgeId('dep'),
        source: f.id,
        target: `fact:${dep.resolvedAbstract}`,
        kind: 'depends',
      }
      if (f.__rootOp) e.via = f.__rootOp
      out.edges.push(e)
    }
  }

  // 4. Strip internal fields and compose the graph.
  const cleanFacts = facts.map(({ __rootOp, ...rest }) => rest)
  const graph = {
    version: '1.0-real',
    generatedAt: new Date().toISOString(),
    taxYear: cfg.taxYear,
    // Declared, not open: validate() accepts these tags and still rejects a typo of one.
    flowTags: cfg.customFlowTags,
    _note: `Generated by scripts/make-static-fgm.mjs from ${cfg.label}'s flow/*.xml + facts/*.xml. Do not edit by hand; rerun the script.`,
    flowPages: out.flowPages,
    flowElements: out.flowElements,
    facts: cleanFacts,
    edges: out.edges,
  }

  const OUT = join(cfg.outDir, 'form-builder-graph.json')
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(graph, null, 2) + '\n')

  const byKind = (k) => out.edges.filter((e) => e.kind === k).length
  console.log(`Wrote ${OUT}`)
  console.log(`  flowPages    ${graph.flowPages.length}`)
  console.log(`  flowElements ${graph.flowElements.length}`)
  console.log(
    `  facts        ${graph.facts.length}  (${cleanFacts.filter((f) => f.kind === 'writable').length} writable / ${cleanFacts.filter((f) => f.kind === 'derived').length} derived)`
  )
  console.log(`  edges        ${graph.edges.length}`)
  for (const k of [
    'sequential',
    'exits',
    'binds',
    'gates',
    'knocks-out',
    'shows',
    'displays',
    'depends',
  ])
    console.log(`    ${k.padEnd(11)} ${byKind(k)}`)

  // Scenario index — enumerate the app's scenario corpus from disk (filesystem only, so this works
  // whether or not the app was built with --scenarioMode) and decode each filename through the
  // vocabulary the app declared. The picker (N4) reads this index; the scenario JSON bodies are
  // fetched live via the Vite proxy at runtime.
  writeScenarioIndex()
  return graph
}

/** Enumerate scenarios/*.json and write the decoded index for the picker (N1.2). */
function writeScenarioIndex() {
  // An app may simply have no scenarios — tax-withholding-estimator does not — which is a shape,
  // not a failure. No directory means no index, and fact-explorer's picker is empty rather than broken.
  if (!cfg.scenariosDir) {
    console.log('  scenarios    (none declared)')
    return
  }
  const { parseFilename } = scenarioVocabulary(cfg.scenarioVocabulary)
  let files = []
  try {
    files = readdirSync(cfg.scenariosDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    console.warn(`  scenarios   (none — ${cfg.scenariosDir} not found)`)
  }
  const scenarios = files.map((filename) => ({ filename, ...parseFilename(filename) }))
  const index = {
    generatedAt: new Date().toISOString(),
    _note: `Generated by scripts/make-static-fgm.mjs from ${cfg.label}'s scenarios/ corpus. Bodies are fetched live via the Vite proxy at ${cfg.basePath}/resources/scenarios/<filename>.`,
    scenarios,
  }
  const SCENARIOS_OUT = join(cfg.outDir, 'scenarios-index.json')
  mkdirSync(dirname(SCENARIOS_OUT), { recursive: true })
  writeFileSync(SCENARIOS_OUT, JSON.stringify(index, null, 2) + '\n')
  console.log(`Wrote ${SCENARIOS_OUT}`)
  console.log(`  scenarios    ${scenarios.length}`)
}

/**
 * Read flow/index.xml's <module src="..."/> order.
 *
 * A hard error rather than a fallback list. Every Form Builder app has a flow/index.xml — it is what
 * `FormBuilder.parseFlow` reads — and the fallback this replaced named credit-assistant's five
 * modules, so any other app with an unreadable index would have been generated silently in the
 * wrong order, out of the wrong files.
 */
function readModuleOrder() {
  const indexPath = join(cfg.flowDir, 'index.xml')
  let mods = []
  try {
    const tree = parser.parse(readFileSync(indexPath, 'utf8'))
    const root = tree.find((n) => !isText(n) && TAG(n) === 'FlowConfig')
    mods = KIDS(root)
      .filter((c) => !isText(c) && TAG(c) === 'module')
      .map((c) => fileBase(ATTR(c).src))
  } catch (err) {
    throw new Error(`${cfg.id}: cannot read ${indexPath} — ${err.message}`)
  }
  if (!mods.length) throw new Error(`${cfg.id}: ${indexPath} declares no <module src="…"/>`)
  return mods
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main(argv) {
  const only = argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : null
  const descriptors = discoverDescriptors(APPS).filter((d) => !only || d.id === only)

  if (!descriptors.length) {
    throw new Error(
      `${
        only
          ? `No app "${only}" — expected a fact-explorer.app.json declaring it under ${APPS}.`
          : `No fact-explorer.app.json found under ${APPS}.`
      }\nApplications live in their own repositories: clone or symlink one into that directory, or ` +
        'set FORM_BUILDER_APPS_DIR. See apps/README.md.'
    )
  }

  for (const d of descriptors) {
    console.log(`\n=== ${d.label ?? d.id} (${d.id}) ===`)
    generateApp(d)
  }

  // Keep the registry in step: a descriptor edited since the last build would otherwise leave
  // apps.json describing an app that no longer matches the graph just written beside it.
  console.log('')
  buildRegistryFile(APPS)
}

main(process.argv.slice(2))
