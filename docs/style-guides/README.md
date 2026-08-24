# Frontend style guides

Three guides covering the hand-written frontend code of this platform: Thymeleaf templates, CSS, and
client JavaScript. They record conventions already established in the production code so that both
people and coding agents extend it the same way.

Each guide follows the same shape: philosophy, rules with do and don't pairs, code excerpts with
file citations, anti-patterns, and a checklist for new code.

## The guides

| Guide | Covers | Read it before touching |
|---|---|---|
| [thymeleaf-html.md](thymeleaf-html.md) | `fragments/` and `nodes/` layout, Thymeleaf attribute conventions, i18n message keys, `fg-*` custom-element markup, forms and ARIA, the all-screens layout | Any `.html` under a `templates/` directory, in the scaffold or in an application override |
| [css.md](css.md) | Stylesheet cascade order, design tokens, USWDS override rules, container queries, accessibility, when to comment | Any stylesheet in an application, in the scaffold theme, or in the workspace package |
| [javascript.md](javascript.md) | Web Components, Fact Graph state and `sessionStorage`, custom events, focus and ARIA in JS, error handling, keeping debug surfaces isolated | Any browser JavaScript that is not built by a bundler |

## Which code each guide governs

The frontend is spread across three repositories, and only one of them is this one. The guides apply
in all three, with the single exception noted below.

| Location | What lives there |
|---|---|
| `form-builder/src/main/resources/form-builder/` | The scaffold's own layer: `templates/` (page, all-screens, `fragments/`, `nodes/`, `nodes/inputs/`) plus `website-static/theme/` and `website-static/flow-runtime/`, which hold the design tokens, the shared component CSS, and the `<fg-set>` / `<fg-collection>` / `<fg-show>` element implementations |
| An application's `src/main/resources/<appId>/`, in its own repository, for example `credit-assistant/` or `tax-withholding-estimator/` in the [example applications](https://github.com/IRS-Public/form-builder-examples) | Each application's own `website-static/` and `templates/`: its `main.css` import root, its brand and component CSS, its flow entry point, its knockout handlers, its template overrides |
| [`packages/ui/src/`](../../packages/ui/src/) | The workspace UI package: global nav, audit panel, tool panels. Plain ESM and CSS with no bundler, so the JavaScript and CSS guides apply in full |

**Fact Explorer is the exception.** [`packages/fact-explorer/`](../../packages/fact-explorer/) is a
React and Vite application with a build step, so the JavaScript guide's rules (no framework, no
bundler, Web Components as the runtime) do not apply to it. Its CSS is still plain CSS in the same
token style. See [packages/fact-explorer/README.md](../../packages/fact-explorer/README.md) for its
own conventions.

Nothing in these guides applies to a `website-static/vendor/` directory. Those are generated mirrors
of the scaffold and the workspace package, overwritten on every build.

## Shared principles

1. **JavaScript is a last resort.** If static HTML generation, a Thymeleaf template, or Flow XML can
   express it, express it there.
2. **Route every literal through a design token.** Reach for USWDS components and the token layer
   first, and write custom code only for genuine gaps.
3. **The Fact Graph is the single source of state**, persisted in `sessionStorage` across the
   multi-page flow.
4. **Accessibility is required at the point of writing** (Section 508): semantic markup, managed
   ARIA, visible focus, keyboard support, reduced-motion fallbacks.
5. **Debug and workspace surfaces stay isolated.** Anything that exists only to inspect the
   application is gated, reversible, and kept out of the taxpayer flow.
6. **Size layout against the container.** Container queries let the form reflow beside the workspace
   panels, which viewport media queries cannot do.

## One caveat on reading them

The guides quote **ADR-001 (TWE 2.0 Architecture)** and **ADR-004 (Internal Debugging Surfaces)**.
Both live with the Tax Withholding Estimator, in
[its repository's `docs/adr/`](https://github.com/IRS-Public/form-builder-examples/tree/main/tax-withholding-estimator/docs/adr),
alongside ADR-002 on security scanning and ADR-003 on PDF generation. They predate the repository
split and describe this platform as a whole.

The guides were originally written against the frontend before it split into the scaffold and the
workspace package, when the Web Component and Fact Graph code lived in one file,
`website-static/js/fg-components.js`, and the workspace lived in another, `audit-panel.js`. Both
have since been reorganized into several files apiece. The custom elements, the Fact Graph
bootstrap and the navigation now live in the scaffold's flow runtime,
`form-builder/src/main/resources/form-builder/website-static/flow-runtime/js/{fg-set,fg-collection,fg-display,fg-conditions,fg-fact-graph,fg-validation,fg-navigator,modals}.js`.
An application still keeps a short `fg-components.js` of its own that imports that runtime and
then whatever is genuinely its own, such as credit-assistant's knockout handlers. The workspace's
files are now `packages/ui/src/audit-panel/js/{taxpert-audit-panel,chat,scenario-modal,display-modal,workspace-settings-modal}.js`
and neighboring files in that bundle. The conventions in the guides still hold. Where a code
excerpt names a specific file, treat it as illustrative of the pattern rather than a guarantee
that the exact line still exists there.
