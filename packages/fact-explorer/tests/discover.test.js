import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverDescriptors } from '../scripts/build-registry.mjs'

// apps/README.md offers `ln -s` beside `git clone` as the way to put an app in the apps directory,
// and the example applications live two levels down in one repository, so linking is the normal
// case rather than the exotic one. A Dirent for a symlink-to-a-directory reports isSymbolicLink()
// and not isDirectory(), which is exactly how a documented route silently discovers nothing.

let root
let elsewhere

const anApp = (dir, id) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'fact-explorer.app.json'), JSON.stringify({ id, appId: id }))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fe-apps-'))
  elsewhere = mkdtempSync(join(tmpdir(), 'fe-repo-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

describe('discoverDescriptors', () => {
  it('returns [] for an apps directory that does not exist', () => {
    expect(discoverDescriptors(join(root, 'nope'))).toEqual([])
  })

  it('finds a cloned app', () => {
    anApp(join(root, 'credit-assistant'), 'credit-assistant')
    expect(discoverDescriptors(root).map((d) => d.id)).toEqual(['credit-assistant'])
  })

  it('finds an app symlinked in from another repository', () => {
    anApp(join(elsewhere, 'tax-withholding-estimator'), 'twe')
    symlinkSync(join(elsewhere, 'tax-withholding-estimator'), join(root, 'twe'))
    expect(discoverDescriptors(root).map((d) => d.id)).toEqual(['twe'])
  })

  it('ignores a directory with no descriptor, and a loose file', () => {
    mkdirSync(join(root, 'notes'))
    writeFileSync(join(root, 'README.md'), '# apps')
    expect(discoverDescriptors(root)).toEqual([])
  })
})
