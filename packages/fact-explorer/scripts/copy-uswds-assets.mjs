// scripts/copy-uswds-assets.mjs — vendors the USWDS font/image assets that the real USWDS
// components (usa-checkbox, usa-button, usa-icon, usa-modal — see src/styles/uswds.scss) need at
// runtime: @font-face src: url(...) and the checkbox's checkmark/indeterminate SVGs.
//
// Sass compiles those url()s to absolute paths (/uswds/fonts/..., /uswds/img/...; see
// $theme-font-path/$theme-image-path in uswds.scss), so the referenced files need to actually
// exist at that path when served. Vite serves public/ verbatim at the site root, so copying
// @uswds/uswds's dist/fonts and dist/img here — unmodified, same relative layout as the
// distributed package — makes those URLs resolve correctly with no bundler config.
//
// public/uswds/ is generated and gitignored (mirrors credit-assistant's vendored
// website-static/vendor/taxpert/ — never hand-edit it, this script is the only writer).
// Runs automatically after `npm install` (see package.json's postinstall); rerun by hand
// (`npm run copy-uswds-assets`) after bumping the @uswds/uswds version.

import { cpSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, parse } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FACT_EXPLORER = resolve(__dirname, '..')

// Find @uswds/uswds by walking up for a node_modules that holds it, rather than assuming
// ./node_modules/@uswds/uswds. Inside an npm workspace the dependency is hoisted to the workspace
// root, so the nested path this used to hardcode does not exist and postinstall failed the whole
// install. Node's own resolver is no help here: the package's `exports` map does not expose
// ./package.json, so require.resolve cannot be used to locate its directory.
function findUswdsDist(from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', '@uswds', 'uswds', 'dist')
    if (existsSync(candidate)) return candidate
    if (dir === parse(dir).root) {
      throw new Error('copy-uswds-assets: @uswds/uswds not found — run `npm install` first')
    }
  }
}

const USWDS_DIST = findUswdsDist(FACT_EXPLORER)
const OUT = join(FACT_EXPLORER, 'public', 'uswds')

for (const asset of ['fonts', 'img']) {
  const src = join(USWDS_DIST, asset)
  const dest = join(OUT, asset)
  if (!existsSync(src)) {
    throw new Error(`copy-uswds-assets: ${src} not found — is @uswds/uswds installed?`)
  }
  rmSync(dest, { recursive: true, force: true })
  cpSync(src, dest, { recursive: true })
  console.log(`copy-uswds-assets: ${asset} -> public/uswds/${asset}`)
}
