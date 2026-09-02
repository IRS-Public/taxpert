import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

// Flat config, migrated from .eslintrc.json when ESLint went to 10 (eslintrc is gone in 9+).
// packages/ui is on ESLint 9 and cannot follow yet: neostandard pins @stylistic 2.11.0, which
// calls sourceCode.isSpaceBetweenTokens — removed in ESLint 10. Rejoin the two when neostandard
// ships its ESLint 10 support (0.14).
export default [
  {
    // dist/ and .vite/ are build output; public/data/ is generated graph fixtures.
    ignores: ['dist/', '.vite/', 'public/data/'],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    // The eslintrc this replaces set env browser+node+es2021 over the whole package rather than
    // per-directory: src/ is browser, scripts/ and vite.config.js are Node, tests/ is both under
    // vitest. Kept as one union so the migration changes no verdicts; narrow it deliberately, not
    // as a side effect of a dependency bump.
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      // Pinned rather than 'detect', which is what the eslintrc used. eslint-plugin-react
      // detects by calling the removed context.getFilename(), so 'detect' throws outright on
      // ESLint 10. This package depends on react ^19, so there is nothing to detect.
      react: { version: '19' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'warn',
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // New in eslint-plugin-react-hooks@7's recommended preset. Both flag pre-existing,
      // deliberate patterns here (init-on-open / reset-on-prop-change effects, and the
      // "latest ref" pattern for resize/dock handlers) rather than bugs. Revisit case-by-case
      // rather than blanket-refactoring on a dependency bump.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
]
