import { describe, it, expect } from 'vitest'
import {
  validateRegistry,
  findApp,
  defaultApp,
  viewsFor,
  embeddableViews,
  appUrl,
} from '../src/model/apps.js'
import {
  buildFactExplorerMenu,
  buildFactExplorerTools,
  FACT_EXPLORER_DESTINATION,
} from '../src/config/taxpertHost.js'

// The registry is as much a contract between the generator and the SPA as the FGM is, so it gets
// the same treatment: validate loudly at boot rather than surface later as a 404 nobody can explain.

const anApp = (over = {}) => ({
  id: 'credit-assistant',
  label: 'Credit Assistant',
  appId: 'credit-assistant',
  basePath: '/app/eitc',
  storagePrefix: 'credit-assistant',
  capabilities: { allScreens: true, scenarioMode: true, authorMode: true },
  scenarios: { base: '/app/eitc/resources/scenarios', index: '/data/x.json', vocabulary: 'eitc' },
  ...over,
})

const aRegistry = (apps, over = {}) => ({
  version: 1,
  defaultAppId: apps[0].id,
  apps,
  ...over,
})

const twe = anApp({
  id: 'twe',
  label: 'Tax Withholding Estimator',
  appId: 'twe',
  basePath: '/app/tax-withholding-estimator',
  storagePrefix: 'twe',
  capabilities: { allScreens: true, scenarioMode: false, authorMode: false },
  scenarios: null,
})

describe('apps.validateRegistry', () => {
  it('accepts a well-formed registry', () => {
    const r = aRegistry([anApp(), twe])
    expect(validateRegistry(r)).toBe(r)
  })

  it('rejects a registry with no apps', () => {
    expect(() => validateRegistry({ defaultAppId: 'x', apps: [] })).toThrow(/no apps/)
  })

  it('rejects duplicate ids', () => {
    expect(() => validateRegistry(aRegistry([anApp(), anApp()]))).toThrow(/duplicate app id/)
  })

  it('rejects a basePath that is not absolute', () => {
    expect(() => validateRegistry(aRegistry([anApp({ basePath: 'app/eitc' })]))).toThrow(
      /basePath starting with/
    )
  })

  it('rejects a missing storagePrefix — it namespaces the fact-graph bridge', () => {
    expect(() => validateRegistry(aRegistry([anApp({ storagePrefix: '' })]))).toThrow(
      /needs a storagePrefix/
    )
  })

  it('rejects a defaultAppId that names no app', () => {
    expect(() => validateRegistry(aRegistry([anApp()], { defaultAppId: 'nope' }))).toThrow(
      /does not name one of/
    )
  })
})

describe('apps.findApp / defaultApp', () => {
  const registry = aRegistry([anApp(), twe])

  it('finds by id', () => {
    expect(findApp(registry, 'twe').label).toBe('Tax Withholding Estimator')
  })

  it('returns null for an unknown id rather than falling back', () => {
    // A stale bookmark that silently shows a *different* app is the worst outcome here.
    expect(findApp(registry, 'not-an-app')).toBeNull()
  })

  it('returns null for an absent id — that is defaultApp’s job, not findApp’s', () => {
    expect(findApp(registry, null)).toBeNull()
    expect(defaultApp(registry).id).toBe('credit-assistant')
  })
})

describe('apps.appUrl', () => {
  it('joins without doubling slashes', () => {
    const app = anApp()
    expect(appUrl(app)).toBe('/app/eitc/')
    expect(appUrl(app, '/all-screens/')).toBe('/app/eitc/all-screens/')
    expect(appUrl(app, 'resources/fact-dictionary.xml')).toBe(
      '/app/eitc/resources/fact-dictionary.xml'
    )
  })
})

describe('apps.viewsFor — capabilities prune destinations', () => {
  it('a fully-featured app gets all four', () => {
    expect(viewsFor(anApp()).map((v) => v.id)).toEqual([
      'product-experience',
      'path-mode',
      'browse-all',
      'authoring-suite',
    ])
  })

  it('drops Author Mode for an app built without it', () => {
    expect(viewsFor(twe).map((v) => v.id)).toEqual([
      'product-experience',
      'path-mode',
      'browse-all',
    ])
  })

  it('drops Browse All and Path Mode without --allScreens — a link there would 404', () => {
    const minimal = anApp({
      capabilities: { allScreens: false, scenarioMode: false, authorMode: false },
    })
    expect(viewsFor(minimal).map((v) => v.id)).toEqual(['product-experience'])
    expect(embeddableViews(minimal).map((v) => v.id)).toEqual(['product-experience'])
  })

  it('builds hrefs under the app’s own base path', () => {
    expect(viewsFor(twe).map((v) => v.href)).toEqual([
      '/app/tax-withholding-estimator/',
      '/app/tax-withholding-estimator/all-screens/?mode=path',
      '/app/tax-withholding-estimator/all-screens/',
    ])
  })
})

describe('taxpertHost menu + tools are pure functions of the app', () => {
  it('puts Fact Explorer in-app and Authoring Suite at top level', () => {
    const menu = buildFactExplorerMenu(anApp())
    const inApp = menu.filter((m) => m.action === 'in-app')
    expect(inApp).toHaveLength(1)
    expect(inApp[0].id).toBe(FACT_EXPLORER_DESTINATION)
    expect(menu.at(-1).id).toBe('authoring-suite')
    expect(menu[0].children.map((c) => c.id)).not.toContain('authoring-suite')
  })

  it('omits Authoring Suite entirely for an app without Author Mode', () => {
    expect(buildFactExplorerMenu(twe).map((m) => m.id)).not.toContain('authoring-suite')
  })

  it('drops the Scenario tool for an app without --scenarioMode', () => {
    expect(buildFactExplorerTools(anApp()).map((t) => t.id)).toContain('scenario')
    expect(buildFactExplorerTools(twe).map((t) => t.id)).not.toContain('scenario')
  })

  it('offers Display in Fact Explorer itself, whatever else the app was built with', () => {
    const minimal = anApp({
      capabilities: { allScreens: false, scenarioMode: false, authorMode: false },
    })
    for (const app of [anApp(), twe, minimal]) {
      const display = buildFactExplorerTools(app).find((t) => t.id === 'display')
      expect(display.destinations).toContain(FACT_EXPLORER_DESTINATION)
    }
  })

  it('prunes destinations a tool can no longer reach', () => {
    const minimal = anApp({
      capabilities: { allScreens: false, scenarioMode: false, authorMode: false },
    })
    for (const tool of buildFactExplorerTools(minimal)) {
      expect(tool.destinations).not.toContain('browse-all')
      expect(tool.destinations).not.toContain('path-mode')
      expect(tool.destinations.length).toBeGreaterThan(0)
    }
  })
})
