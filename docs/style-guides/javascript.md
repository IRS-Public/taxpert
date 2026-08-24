# JavaScript style guide

Conventions for the hand-written, build-tool-free client JavaScript across the platform: the flow
runtime, an application's own scripts, and the taxpert workspace package. They were written
against the original Tax Withholding Estimator (TWE) frontend, before that JavaScript split across
repositories, and the decisions still cited, **ADR-001 (TWE 2.0 Architecture)** and **ADR-004
(Internal Debugging Surfaces)**, live with the Tax Withholding Estimator, in its repository's
`docs/adr/`. The conventions still hold in all three locations. See
[the style guide index](README.md#which-code-each-guide-governs) for which directory each one
applies to. Fact Explorer is the one exception. It is a React and Vite application, and this
guide's no-framework, no-bundler rules do not apply there.

---

## 1. Philosophy: JavaScript is a last resort

A Form Builder application is a static-site generator. The page is HTML generated from Flow XML.
JavaScript only adds the interactivity HTML genuinely cannot express: writing to the Fact Graph,
conditional show and hide, focus management. ADR-001 is explicit:

> Use static HTML generation rather than dynamic DOM manipulation wherever possible. The
> only time new JavaScript should be introduced is when the desired functionality cannot be
> reasonably accomplished with static HTML generation.

Concrete rules that follow from this:

- **Do** prefer adding a `node` or `input` Thymeleaf template, or a Flow XML feature, over new JS.
- **Do** keep each surface's JS in a single, focused file with no bundler step. The code runs
  natively in the browser as ES modules. There is no transpile step and no `node_modules` in the
  build.
- **Do** use [JSDoc](https://jsdoc.app/) for editor hints, since there is no TypeScript.
- **Don't** reach for a framework, reactive library, or virtual DOM. Web Components and the Fact
  Graph are the whole runtime.
- **Don't** add a dependency. The flow runtime's only client dependency is the vendored Fact Graph
  bundle. An application may also vendor a standalone library for something like PDF generation.

---

## 2. Web Components

Every interactive unit is a custom element: a class extending `HTMLElement`, registered with a
kebab-case tag.

### Definition and registration

```js
class FgSet extends HTMLElement {
  constructor () {
    super()
    this.DEFAULT_ERROR_ELEMENT_ID = 'errors.Default'
    // Bind-store listeners in the constructor so they can be removed later (see section 2.3)
    this.tabListener = (event) => { /* ... */ }
  }
  // ...
}
customElements.define('fg-set', FgSet)
```

*Pattern from `fg-set.js` in the flow runtime, `form-builder/src/main/resources/form-builder/website-static/flow-runtime/js/`.*

| Concern | Convention |
| --- | --- |
| Class name | `PascalCase`, mirrors the tag: `FgSet`, `FgCollection`, `FgShow`, `ModalLink`, `AuditedFact` |
| Tag name | `kebab-case` with a domain prefix: `fg-*` (Fact Graph), `modal-*`, `taxpert-*` and `audited-fact`/`fact-link` (workspace) |
| Registration | `customElements.define('fg-set', FgSet)` at the bottom of the file, after all classes |

### Lifecycle: read attributes in `connectedCallback`, clean up in `disconnectedCallback`

This codebase **does not use `observedAttributes` or `attributeChangedCallback`.** Attributes are
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

- **Don't** pass an anonymous arrow function to a `document` or `window` `addEventListener` you
  intend to remove. You will have no handle to remove it.

### Switch on input type

`FgSet` drives validation and rendering off `inputType`. The same `switch (this.inputType)` shape
recurs across `connectedCallback`, `setInputValueFromFactValue`, and
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

---

## 3. State and events

### The Fact Graph is the single source of truth

State lives in one `factGraph` instance, hydrated from a namespaced `sessionStorage` key with a
fresh-graph fallback, exposed on `window`, and announced through a custom event. This is
`fg-fact-graph.js` today:

```js
const graphKey = () => storageKey('factGraph')

const serializedGraphJSON = sessionStorage.getItem(graphKey())
export let factGraph = serializedGraphJSON
  ? fg.GraphFactory.fromJSON(factDictionary, serializedGraphJSON)
  : fg.GraphFactory.apply(factDictionary)

window.factGraph = factGraph
document.dispatchEvent(new CustomEvent('fg-load'))

export function saveFactGraph () {
  const serialized = factGraph.toJSON()
  sessionStorage.setItem(graphKey(), serialized)
  // ...
}
```

The storage key is namespaced by `storageKey()`, which prefixes with the application's
`storagePrefix` so two Form Builder applications served from one origin do not rehydrate each
other's graph.

- **Do** persist with `saveFactGraph()` after every mutation. Because an application is
  multi-page, not a single-page app, `sessionStorage` is what carries state across navigations.
- **Do** read and write facts through the Fact Graph API: `factGraph.get(path)`,
  `.set(path, value)`, `.delete(path)`, and `.get(path).complete`.

### Custom events for cross-component reactivity

Components coordinate through document-level `CustomEvent`s rather than direct references:

| Event | Meaning |
| --- | --- |
| `fg-load` | Fact Graph is ready (fired once at startup) |
| `fg-update` | A fact changed, dependent displays should re-render |
| `fg-clear` | Reset request, inputs should clear themselves |

```js
document.dispatchEvent(new CustomEvent('fg-update'))
```

### Attribute-driven configuration

Behavior is configured by HTML attributes emitted by the Scala generator, never hard-coded in JS:
`path`, `condition`, `operator`, `inputtype`, `optional`, `collectionPath`, `collectionId`. This
keeps the JS generic and the per-question logic in the Flow XML.

---

## 4. DOM querying and manipulation

- **Do** query with semantic or USWDS selectors: `this.querySelectorAll('input, select')`,
  `this.querySelector('.usa-error-message')`.
- **Do** use optional chaining defensively for elements that may not exist:
  `this.querySelector('div.alert--warning')?.remove()`.
- **Do** scope queries to `this` inside a component. Reach for `document` only for genuinely
  global concerns: events, shared singletons.

### Collections: clone a template, then rewrite abstract paths

Repeating collection items are built by cloning a Thymeleaf `<template>` and rewriting its
wildcard (`/*/`) paths to a concrete collection id. This lives in `fg-collection-utils.js` in the
flow runtime:

```js
export function configureCollectionIds (template, collectionId) {
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

export function makeCollectionIdPath (abstractPath, id) {
  return abstractPath.replace('*', `#${id}`)
}
```

`makeCollectionIdPath` is duplicated, one line, byte-identical, in taxpert's
`shared/js/collection-utils.js`, because the flow runtime ships inside a Scala jar and taxpert
cannot import from it. Keep the two in sync.

---

## 5. Accessibility lives in the JS as well as the markup

USWDS gives accessible *markup*. The JS must keep ARIA state and focus correct as the DOM mutates.

### Manage `aria-describedby` and `aria-invalid` as errors come and go

When clearing a validation error, surgically remove just that error id from `aria-describedby`
(don't clobber other ids):

```js
const updatedIds = ariaDescription
  .split(' ')
  .filter(id => id.trim() && id !== errorId)
  .join(' ')
updatedIds
  ? elementWithDescription.setAttribute('aria-describedby', updatedIds)
  : elementWithDescription.removeAttribute('aria-describedby')
```

### The temporary-`tabindex` focus pattern

To move focus to a non-interactive element (the first field in error, for example) without
leaving a stray tab stop, add `tabindex="-1"`, focus, then remove it on blur:

```js
firstErrorFocusTarget.setAttribute('tabindex', '-1')
firstErrorFocusTarget.focus()
firstErrorFocusTarget.addEventListener('blur', () => {
  firstErrorFocusTarget.removeAttribute('tabindex')
}, { once: true })
```

The workspace package uses the same pattern for `<audited-fact>` in
`packages/ui/src/audit-panel/js/audited-fact.js`.

### Keyboard handling

- **Tab** re-evaluates conditions *before* focus leaves, so visibility is correct as a person tabs
  forward.
- **Escape** closes the workspace panel.
- **Arrow keys** resize the workspace dock, with `aria-valuenow` and `aria-valuetext` kept current.
- **Modals trap focus.** `Tab` and `Shift+Tab` wrap between the first and last focusable elements
  (`modals.js` in the flow runtime), and focus is sent to the first focusable element on open.

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

- **Do** guard reads that can throw and choose a safe default rather than breaking the page:

  ```js
  try {
    value = factGraph.get(condition)
  } catch (e) {
    console.error(`Error attempting to fetch ${condition}, ignoring condition:\n`, e)
    return true // safe default: show the content
  }
  ```

- **Do** warn, don't throw, when optional wiring is missing:
  `console.warn(\`No modal found for ${this.modalId}\`)`.
- **Do** use `console.debug` for lifecycle tracing (`Adding fg-set with path ...`).

---

## 7. Module structure and naming

- **ES modules**, top-of-file imports: `import { fg } from './fact-graph-engine.js'`.
- **Public and console APIs** are both `export`ed and attached to `window`, so they can be called
  from the browser console and imported by other modules:

  ```js
  export function enable () { /* ... */ }
  window.enableAuditMode = enable       // taxpert-audit-panel.js
  window.loadFactGraph = loadFactGraph  // fg-fact-graph.js debug helper
  ```

- **File layout**, top to bottom: imports, then global state init, then helper functions, then
  custom-element classes, then `customElements.define(...)` calls, then document-level listeners
  or boot code.
- **Naming.** `PascalCase` classes, `camelCase` functions and variables, `UPPER_SNAKE_CASE` module
  constants (`COLLECTION_ID_PLACEHOLDER`, `DEFAULT_ERROR_ELEMENT_ID`), `kebab-case` tags and
  `data-*` attributes.
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

---

## 8. Debugging surfaces must stay isolated from the taxpayer flow

Per ADR-004, the workspace ships to production but must never alter the taxpayer experience unless
explicitly enabled. The isolation contract:

- **Gate behind console functions.** `window.enableAuditMode()` and `window.disableAuditMode()`,
  assigned in `taxpert-audit-panel.js`. Nothing workspace-related runs until enabled, and a build
  without the `--auditMode` flag loads no workspace module at all.
- **Toggle the stylesheet and visibility, don't inline styles:**
  ```js
  document.querySelector('#audit-panel-styles').disabled = false
  ```
- **Guard one-time wiring** so re-enabling doesn't double-bind:
  ```js
  if (auditPanel?.dataset.visibilityControlsInitialized !== 'true') {
    openAuditPanelButton.addEventListener('click', openAuditPanel)
    auditPanel.dataset.visibilityControlsInitialized = 'true'
  }
  ```
- **Wrap, don't replace.** The workspace's Inspect tool wraps hoverable cues around the page's own
  elements and fully reverses the wrapping on disable, leaving the original DOM intact.
- **Persist panel state in its own `sessionStorage` key**, validated against an allow-list of
  fields, so the panel survives multi-page navigation, exactly like the Fact Graph does.
- **Keep workspace code in its own package.** It lives in `packages/ui/src/`, vendored into an
  application by `make copy-shared-ui`, loaded conditionally, and never imported into the flow
  runtime's own path.

---

## 9. Anti-patterns

- Adding JS for something a Thymeleaf template or Flow XML feature could render statically.
- A new npm or client dependency, or a build or transpile step, in the flow runtime or the
  workspace package.
- `observedAttributes` or `attributeChangedCallback`. That is not the pattern here. Read attrs in
  `connectedCallback`.
- Anonymous listeners on `document` or `window` that can never be removed, or a missing
  `disconnectedCallback` cleanup.
- Mutating the DOM without updating `aria-*`, or moving focus to an element without the
  temporary-`tabindex` dance.
- Reading or writing fact state anywhere but the `factGraph` instance, or forgetting
  `saveFactGraph()` after a mutation.
- Workspace or debug logic that mutates the taxpayer DOM irreversibly, runs before
  `enableAuditMode()`, or lives outside its own package.

---

## 10. Checklist for new client JS

- [ ] Confirmed this genuinely cannot be done with static HTML generation (ADR-001).
- [ ] One focused file, no build step. JSDoc on non-trivial functions.
- [ ] Web Component: `PascalCase` class, `kebab-case` prefixed tag, `customElements.define` at the
      end of the file.
- [ ] Attributes read in `connectedCallback`. Child refs cached on `this`.
- [ ] Every `document` or `window` listener is bound, stored, and removed in
      `disconnectedCallback`.
- [ ] Fact state goes through `factGraph`. `saveFactGraph()` runs after mutations, and `fg-update`
      is dispatched if displays depend on it.
- [ ] `aria-describedby` and `aria-invalid` stay correct. Focus moves use the temporary
      `tabindex`. Keyboard paths are handled.
- [ ] Risky reads are wrapped in `try/catch` with safe defaults and `console.error` or
      `console.warn`.
- [ ] Workspace or debug code is gated behind enable and disable, wraps rather than replaces, is
      reversible, keeps state in its own `sessionStorage` key, and lives in its own package.
