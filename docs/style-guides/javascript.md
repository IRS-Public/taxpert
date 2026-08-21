# JavaScript Style Guide — Frontend

Conventions for the hand-written, build-tool-free client JavaScript that powers the Tax
Withholding Estimator (TWE) / credit-assistant frontend. Derived from the production code
in `website-static/js/` (`fg-components.js`, `audit-panel.js`, `debug-components.js`,
`modals.js`, `w4-pdf.js`) and the architecture decisions **ADR-001 (TWE 2.0 Architecture)** and
**ADR-004 (Internal Debugging Surfaces)** — both in the TWE repo under `docs/adr/`.

---

## 1. Philosophy — JavaScript is a last resort

TWE is a static-site generator. The page is HTML generated from Flow XML; JavaScript only
adds the interactivity that HTML genuinely cannot express (writing to the Fact Graph,
conditional show/hide, focus management). ADR-001 is explicit:

> Use static HTML generation rather than dynamic DOM manipulation wherever possible. The
> only time new JavaScript should be introduced is when the desired functionality cannot be
> reasonably accomplished with static HTML generation.

Concrete rules that follow from this:

- **Do** prefer adding a `node`/`input` Thymeleaf template or a Flow XML feature over new JS.
- **Do** keep each surface's JS in a single, focused file with no bundler step. The code runs
  natively in the browser as ES modules — there is no transpile, no `node_modules` in the build.
- **Do** use [JSDoc](https://jsdoc.app/) for IntelliSense, since there is no TypeScript.
- **Don't** reach for a framework, reactive library, or virtual DOM. Web Components + the
  Fact Graph are the whole runtime.
- **Don't** add a dependency. The only client dependencies are the vendored Fact Graph bundle
  and a standalone PDF library.

---

## 2. Web Components

Every interactive unit is a custom element: a class extending `HTMLElement`, registered with
a kebab-case tag.

### Definition and registration

```js
/*
 * <fg-set> - An input that sets a fact
 */
class FgSet extends HTMLElement {
  constructor () {
    super()
    this.DEFAULT_ERROR_ELEMENT_ID = 'errors.Default'
    // Bind-store listeners in the constructor so they can be removed later (see §2.3)
    this.tabListener = (event) => { /* ... */ }
  }
  // ...
}
customElements.define('fg-set', FgSet)
```
*— `fg-components.js:68`, registration at `fg-components.js:509`*

| Concern | Convention |
| --- | --- |
| Class name | `PascalCase`, mirrors the tag: `FgSet`, `FgCollection`, `FgShow`, `ModalLink`, `AuditedFact` |
| Tag name | `kebab-case` with a domain prefix: `fg-*` (Fact Graph), `modal-*`, `audited-fact`/`fact-link` (audit) |
| Registration | `customElements.define('fg-set', FgSet)` at the bottom of the file, after all classes |

### Lifecycle: read attributes in `connectedCallback`, clean up in `disconnectedCallback`

This codebase **does not use `observedAttributes`/`attributeChangedCallback`.** Attributes are
configuration, read once when the element connects.

```js
connectedCallback () {
  this.condition = this.getAttribute('condition')
  this.operator = this.getAttribute('operator')
  this.inputType = this.getAttribute('inputtype')
  this.inputs = this.querySelectorAll('input, select')
  this.optional = this.getAttribute('optional') === 'true'
  // ... attach input listeners by type ...
  this.path = this.getAttribute('path')
  this.render()
}

disconnectedCallback () {
  document.removeEventListener('fg-clear', this.clear)
}
```
*— `fg-components.js:85` / `:155`*

- **Do** cache child element references and parsed attributes onto `this` in `connectedCallback`.
- **Do** mirror every `document.addEventListener` in `connectedCallback` with a matching
  `removeEventListener` in `disconnectedCallback`.

### Store bound listeners so they can be removed

Document-level listeners must be removable, so bind once and keep the reference:

```js
// This is done with bind, rather than an arrow function, so that it can be removed later
this.clear = this.clear.bind(this)
document.addEventListener('fg-clear', this.clear)
```
*— `fg-components.js:148`*

- **Don't** pass an anonymous arrow function to a `document`/`window` `addEventListener` you
  intend to remove — you'll have no handle to remove it.

### Switch on input type

`FgSet` drives validation and rendering off `inputType`. The same `switch (this.inputType)`
shape recurs across `connectedCallback`, `setInputValueFromFactValue`, and
`getFactValueFromInputValue`. Keep these switches consistent and **comment when a switch is
intentionally non-exhaustive**:

```js
switch (this.inputType) {
  // This switch statement is intentionally not exhaustive
  case 'date': { /* fires onChange only when all or none of the sub-fields are filled */ break }
  case 'dollar': /* ... */ break
  case 'select': case 'boolean': case 'enum': case 'multi-enum': /* ... */ break
  default: /* text-like: validate on blur, re-evaluate conditions on Tab keydown */
}
```
*— `fg-components.js:92`*

---

## 3. State and events

### The Fact Graph is the single source of truth

State lives in one `factGraph` instance, hydrated from `sessionStorage` with a fresh-graph
fallback, exposed on `window`, and announced via a custom event:

```js
let factGraph
const serializedGraphJSON = sessionStorage.getItem('factGraph')
if (serializedGraphJSON) {
  factGraph = fg.GraphFactory.fromJSON(factDictionary, serializedGraphJSON)
} else {
  factGraph = fg.GraphFactory.apply(factDictionary)
}
window.factGraph = factGraph
document.dispatchEvent(new CustomEvent('fg-load'))

function saveFactGraph () {
  sessionStorage.setItem('factGraph', factGraph.toJSON())
}
```
*— `fg-components.js:9`*

- **Do** persist with `saveFactGraph()` after every mutation. Because TWE is multi-page (not an
  SPA), `sessionStorage` is what carries state across navigations.
- **Do** read/write facts through the Fact Graph API: `factGraph.get(path)`, `.set(path, value)`,
  `.delete(path)`, and `.get(path).complete`.

### Custom events for cross-component reactivity

Components coordinate through document-level `CustomEvent`s rather than direct references:

| Event | Meaning |
| --- | --- |
| `fg-load` | Fact Graph is ready (fired once at startup) |
| `fg-update` | A fact changed; dependent displays should re-render |
| `fg-clear` | Reset request; inputs should clear themselves |

```js
document.dispatchEvent(new CustomEvent('fg-update'))
```
*— e.g. `fg-components.js:453`*

### Attribute-driven configuration

Behavior is configured by HTML attributes emitted by the Scala generator — never hard-coded in
JS: `path`, `condition`, `operator`, `inputtype`, `optional`, `collectionPath`, `collectionId`.
This keeps the JS generic and the per-question logic in the Flow XML.

---

## 4. DOM querying and manipulation

- **Do** query with semantic / USWDS selectors: `this.querySelectorAll('input, select')`,
  `this.querySelector('.usa-error-message')`.
- **Do** use optional chaining defensively for elements that may not exist:
  `this.querySelector('div.alert--warning')?.remove()` (`fg-components.js:161`).
- **Do** scope queries to `this` inside a component; reach for `document` only for genuinely
  global concerns (events, shared singletons).

### Collections: clone a template, then rewrite abstract paths

Repeating collection items are built by cloning a Thymeleaf `<template>` and rewriting its
wildcard (`/*/`) paths to a concrete collection id:

```js
function configureCollectionIds (template, collectionId) {
  const attributes = ['path', 'condition', 'id', 'for', 'name', 'aria-describedby']
  const nodesWithAbstractPaths =
    template.querySelectorAll(attributes.map(attr => `[${attr}*="/*/"]`).join(','))
  for (const node of nodesWithAbstractPaths) {
    for (const attribute of attributes) {
      const path = node.getAttribute(attribute)
      if (path) node.setAttribute(attribute, makeCollectionIdPath(path, collectionId))
    }
  }
}

function makeCollectionIdPath (abstractPath, id) {
  return abstractPath.replace('*', `#${id}`)
}
```
*— `fg-components.js:43` / `:61`*

`makeCollectionIdPath` is duplicated in `audit-panel.js`; when you touch one, keep them in sync.

---

## 5. Accessibility (it's in the JS, not just the markup)

USWDS gives accessible *markup*; the JS must keep ARIA state and focus correct as the DOM mutates.

### Manage `aria-describedby` and `aria-invalid` as errors come and go

When clearing a validation error, surgically remove just that error id from
`aria-describedby` (don't clobber other ids):

```js
const updatedIds = ariaDescription
  .split(' ')
  .filter(id => id.trim() && id !== errorId)
  .join(' ')
updatedIds
  ? elementWithDescription.setAttribute('aria-describedby', updatedIds)
  : elementWithDescription.removeAttribute('aria-describedby')
```
*— `fg-components.js:168`*

### The temporary-`tabindex` focus pattern

To move focus to a non-interactive element (e.g. the first field in error) without leaving a
stray tab stop, add `tabindex="-1"`, focus, then remove it on blur:

```js
firstErrorFocusTarget.setAttribute('tabindex', '-1')
firstErrorFocusTarget.focus()
firstErrorFocusTarget.addEventListener('blur', () => {
  firstErrorFocusTarget.removeAttribute('tabindex')
}, { once: true })
```
*— `fg-components.js:899` (same pattern for `audited-fact` in `audit-panel.js`)*

### Keyboard handling

- **Tab** re-evaluates conditions *before* focus leaves, so visibility is correct as the user
  tabs forward (`tabListener`, `fg-components.js:74`).
- **Escape** closes the audit panel (`audit-panel.js`).
- **Arrow keys** resize the audit panel, with `aria-valuenow`/`aria-valuetext` kept current.
- **Modals trap focus**: `Tab`/`Shift+Tab` wrap between the first and last focusable elements
  (`modals.js`), and focus is sent to the first focusable element on open.

---

## 6. Error handling and defensive coding

- **Do** wrap fact mutations in `try/catch` and surface a human-readable message. Look the error
  text up from a DOM template by error name, falling back to a default:

  ```js
  try {
    const res = this.setFact()
    if (res.errorType) {
      const errorElement =
        document.getElementById(`errors.${res.errorName}`) ||
        document.getElementById(this.DEFAULT_ERROR_ELEMENT_ID)
      this.setValidationError(errorElement.innerText + ' ' + (res.expectedValue || ''))
    } else {
      this.clearValidationError()
    }
  } catch (error) {
    this.setValidationError(error.message)
  }
  ```
  *— `fg-components.js:253`*

- **Do** guard reads that can throw and choose a safe default rather than breaking the page:

  ```js
  try {
    value = factGraph.get(condition)
  } catch (e) {
    console.error(`Error attempting to fetch ${condition}, ignoring condition:\n`, e)
    return true // safe default: show the content
  }
  ```
  *— `fg-components.js:776`*

- **Do** warn (don't throw) when optional wiring is missing: `console.warn(\`No modal found for ${this.modalId}\`)` (`modals.js`).
- **Do** use `console.debug` for lifecycle tracing (`Adding fg-set with path ...`).

---

## 7. Module structure and naming

- **ES modules**, top-of-file imports: `import * as fg from '../vendor/fact-graph/factgraph-3.1.0.js'`.
- **Public / console APIs** are both `export`ed and attached to `window` so they can be called
  from the browser console and imported by other modules:

  ```js
  export function enable () { /* ... */ }
  window.enableAuditMode = enable      // audit-panel.js
  window.downloadW4 = downloadW4       // w4-pdf.js
  window.loadFactGraph = loadFactGraph // fg-components.js debug helper
  ```

- **File layout** (top → bottom): imports → global state init → helper functions →
  custom-element classes → `customElements.define(...)` calls → document-level listeners / boot.
- **Naming:** `PascalCase` classes, `camelCase` functions/vars, `UPPER_SNAKE_CASE` module
  constants (`COLLECTION_ID_PLACEHOLDER`, `DEFAULT_ERROR_ELEMENT_ID`, `AUDIT_PANEL_STORAGE_KEY`),
  `kebab-case` tags and `data-*` attributes.
- **Memoize one-shot fetches** with a module-scoped promise so the resource loads at most once:

  ```js
  let factDictionaryXmlPromise
  function loadFactDictionaryXml () {
    if (!factDictionaryXmlPromise) {
      factDictionaryXmlPromise = fetch(/* ... */).then(r => r.text()).then(/* ... */)
    }
    return factDictionaryXmlPromise
  }
  ```
  *— `audit-panel.js`*

---

## 8. Debugging surfaces must stay isolated from the taxpayer flow

Per ADR-004 the audit panel ships to production but must never alter the taxpayer experience
unless explicitly enabled. The isolation contract:

- **Gate behind console functions.** `window.enableAuditMode()` / `window.disableAuditMode()`
  (and `enableAuditMode` by default in local dev). Nothing audit-related runs until enabled.
- **Toggle the stylesheet and visibility, don't inline styles:**
  ```js
  document.querySelector('#audit-panel-styles').disabled = false
  document.querySelector('#audit-panel').classList.remove('hidden')
  ```
- **Guard one-time wiring** so re-enabling doesn't double-bind:
  ```js
  if (auditPanel?.dataset.visibilityControlsInitialized !== 'true') {
    openAuditPanelButton.addEventListener('click', openAuditPanel)
    auditPanel.dataset.visibilityControlsInitialized = 'true'
  }
  ```
- **Wrap, don't replace.** Audit mode wraps each `fg-show` in a `fact-link`, and **fully
  reverses it on disable** — leaving the original DOM intact.
- **Persist panel state in its own `sessionStorage` key** (validated against an allow-list of
  fields) so the panel survives multi-page navigation, exactly like the Fact Graph does.
- **Keep audit/debug code in its own files** (`audit-panel.js`, `debug-components.js`), loaded
  conditionally, never imported into the core `fg-components.js` path.

---

## 9. Anti-patterns

- ❌ Adding JS for something a Thymeleaf template or Flow XML feature could render statically.
- ❌ A new npm/client dependency or a build/transpile step.
- ❌ `observedAttributes`/`attributeChangedCallback` (not the pattern here — read attrs in `connectedCallback`).
- ❌ Anonymous listeners on `document`/`window` that can never be removed; missing `disconnectedCallback` cleanup.
- ❌ Mutating the DOM without updating `aria-*`; moving focus to an element without the temporary-`tabindex` dance.
- ❌ Reading/writing fact state anywhere but the `factGraph` instance, or forgetting `saveFactGraph()` after a mutation.
- ❌ Audit/debug logic that mutates the taxpayer DOM irreversibly, runs before `enableAuditMode()`, or lives in core files.

---

## 10. Checklist for new client JS

- [ ] Confirmed this genuinely can't be done with static HTML generation (ADR-001).
- [ ] One focused file, no build step; JSDoc on non-trivial functions.
- [ ] Web Component: `PascalCase` class, `kebab-case` prefixed tag, `customElements.define` at file end.
- [ ] Attributes read in `connectedCallback`; child refs cached on `this`.
- [ ] Every `document`/`window` listener is bound, stored, and removed in `disconnectedCallback`.
- [ ] Fact state goes through `factGraph`; `saveFactGraph()` after mutations; `fg-update` dispatched if displays depend on it.
- [ ] `aria-describedby`/`aria-invalid` kept correct; focus moves use temporary `tabindex`; keyboard paths handled.
- [ ] Risky reads wrapped in `try/catch` with safe defaults and `console.error`/`console.warn`.
- [ ] If it's audit/debug: gated behind enable/disable, wrap-not-replace, reversible, state in its own `sessionStorage` key, in its own file.
