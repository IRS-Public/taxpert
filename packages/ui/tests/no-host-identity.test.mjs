// The guard: taxpert must not know which application it is wrapping.
//
// Cheap, decisive, and the reason the eviction stays evicted. Every literal this scans for was in
// src/ before the config refactor — 34 fact paths of one host's eligibility rules, its deployed
// route prefix in the nav menu, its product name in the chat placeholder, another consumer's dev
// server URL in a menu entry. Each one meant the package only worked on one application.
//
// A hit here is not a style problem. It means a host's identity has been compiled back into the
// library, and the next host to adopt it gets 404s, permanently-unresolvable determinations, or
// copy that lies about what the product is.
//
// Comments count. A comment naming a host is usually the first sign its content is drifting back.
// Where a comment genuinely needs to describe what moved out, it names the *concept* ("one host's
// fact paths") rather than the host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// The directories that ship. tests/ is exempt: a spec must be able to play a host, and
// tests/fixtures/host/ exists precisely to name concrete routes and paths.
const SHIPPED = ['src', 'react']

// The line this draws: a host's *name in prose* is fine — a comment may say that a default
// reproduces credit-assistant's markup, because that is where the default came from and there is no
// other way to say it. What must never appear is a host's addressable identity: a route it is
// deployed under, one of its fact paths, its product name in copy the user reads. Those are
// coupling; the prose is documentation.
//
// `/app/<something>/` is the most valuable of the three, because it is the only one written against
// a *shape* rather than a name: it catches a new host's routes being hardcoded, not just the
// original host's.
const FORBIDDEN = [
  { pattern: /eitc/i, what: "a host application's name in a path or string" },
  { pattern: /\/app\/[a-z-]+\//i, what: "a host's deployed route prefix" },
  { pattern: /localhost:5180/, what: "a consumer's dev-server URL" },
]

async function * walk (dir) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield * walk(path)
    else if (/\.(js|jsx|mjs|css|html)$/.test(entry.name)) yield path
  }
}

test('no host application identity is compiled into the shipped bundles', async () => {
  const violations = []

  for (const top of SHIPPED) {
    for await (const path of walk(join(ROOT, top))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const text = await readFile(path, 'utf8')
      const lines = text.split('\n')

      for (const { pattern, what } of FORBIDDEN) {
        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            violations.push(`${relative(ROOT, path)}:${index + 1} — ${what}\n    ${line.trim()}`)
          }
        })
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    'taxpert must ship no host\'s identity. A host supplies these via configure().\n\n' +
      violations.join('\n')
  )
})

test('the shipped bundles declare no determinations of their own', async () => {
  // The Outcome tracker's content is the single largest thing that was hardcoded. Its absence is
  // worth asserting directly rather than only via the string scan: a determination list could come
  // back under any naming.
  for (const top of SHIPPED) {
    for await (const path of walk(join(ROOT, top))) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const text = await readFile(path, 'utf8')
      // A path must *name* something to be host identity: `/` on its own is the root and names no
      // fact, which is what the Outcomes editor seeds a blank determination with so that the
      // validator accepts it before anyone has typed a path.
      assert.ok(
        !/rollupPath\s*:\s*['"`]\/\w/.test(text),
        `${relative(ROOT, path)} declares a determination with a concrete rollup path. ` +
          'Determinations belong to a host, supplied via configure({ determinations }).'
      )
    }
  }
})
