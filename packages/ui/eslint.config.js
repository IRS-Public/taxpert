import globals from 'globals'
import { defineConfig } from 'eslint/config'
import neostandard from 'neostandard'
import security from 'eslint-plugin-security'
import react from 'eslint-plugin-react'

export default defineConfig([
  {
    // TX-3: dist/ is the bundled build (`npm run build`), generated from the src/ that IS linted.
    // Linting a bundler's output is linting the bundler.
    ignores: ['dist/'],
  },
  ...neostandard(),
  security.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
      'no-implicit-globals': 'error',
      eqeqeq: 'error',
    },
  },
  {
    // Markup lives in each bundle's templates/*.html; elements clone a <template> and wire it.
    // Building DOM from an HTML string is the exception here, not the default — see the
    // "Clone, don't construct" rule in CLAUDE.md.
    //
    // Genuinely dynamic generators keep an inline `eslint-disable-next-line` naming why:
    //   • shared/js/templates.js — parses the bundle's own template file, the one place that must
    //   • audit-panel/js/condition-detail.js — a recursive XML → HTML transpiler over arbitrary
    //     fact-dictionary structure; a <template> has nothing to offer it
    //   • audit-panel/js/chat.js — a markdown renderer over LLM response text
    //   • audit-panel/js/audited-fact.js — serialized fact XML with <fact-link>s spliced in
    // Host-supplied HTML strings (a scenario library, a language list) go through DOMParser
    // instead, which parses inertly.
    files: ['src/**/js/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression > MemberExpression[property.name='innerHTML'], AssignmentExpression > MemberExpression[property.name='outerHTML']",
          message:
            'Put the markup in the bundle\'s templates/*.html and clone it (getTemplate). If the output is genuinely data-derived, build nodes — or disable this rule on the line with a reason.',
        },
        {
          selector: "CallExpression > MemberExpression[property.name='insertAdjacentHTML']",
          message:
            'Put the markup in the bundle\'s templates/*.html and clone it (getTemplate), or append nodes. For a host-supplied HTML string, parse it with DOMParser.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['react/**/*.jsx'],
    plugins: { react },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    // Build tooling, not shipped code. It runs under Node on a developer's machine and on CI,
    // over this package's own directory — so `globals.browser` is wrong for it, and
    // eslint-plugin-security's filesystem rules are aimed at a threat model it is not in: every
    // path it builds is rooted at this file's own location. The rules that are about correctness
    // rather than untrusted input still apply.
    files: ['scripts/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
])
