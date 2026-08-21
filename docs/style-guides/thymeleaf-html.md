# HTML / Thymeleaf Style Guide — TWE Frontend

Conventions for the Thymeleaf templates and generated HTML behind the Tax Withholding
Estimator (TWE) / credit-assistant frontend. Derived from `templates/` (`page.html`,
`all-screens.html`, `fragments/`, `nodes/`, `nodes/inputs/`) and the decisions **ADR-001 (TWE 2.0
Architecture)** and **ADR-004 (Internal Debugging Surfaces)** — both in the TWE repo under `docs/adr/`.

---

## 1. Philosophy — Flow XML in, HTML out

TWE is a static-site generator. Tax-logic engineers write **Flow XML** ("questions"); the Scala
generator transforms it into HTML using a small set of `fg-*` custom elements that bridge form
inputs to the Fact Graph. Plain HTML passes through untouched (ADR-001):

> The generated static HTML largely consists of `<fg-set>` custom elements, which enhance HTML
> form inputs with the ability to set values in a fact graph … Everything else, the regular HTML
> elements, will get passed through, unmodified, to the static output.

The implications for templates:

- **Do** put per-question content and logic in **Flow XML** and the YAML locale files, not in the
  templates. Templates are the reusable rendering layer.
- **Do** add a `nodes/` template when you need a new custom element, or a `nodes/inputs/`
  template for a new input type.
- **Don't** bake user-facing copy into a template — it belongs in a `#{...}` message key.

---

## 2. Template organization

```
templates/
  page.html              ← main, user-facing flow layout
  all-screens.html       ← dev-only review layout (renders every field)
  errors.html            ← client error-message templates
  fragments/             ← shared page chrome
    head.html  usa-banner.html  usa-step-indicator.html
    audit-panel.html  js-templates.html  lock.html
  nodes/                 ← one template per custom element
    fg-set.html  fg-alert.html  fg-detail.html  fg-collection.html
    fg-apply.html  modal-dialog.html  modal-link.html
    question-label.html  hint.html  section.html
    inputs/              ← one template per input type
      text.html  dollar.html  int.html  date.html  boolean.html
      enum.html  multi-enum.html  select.html  single-checkbox.html
```

- **Filenames are `kebab-case` and match the element/concept** they render (`fg-set.html`
  → `<fg-set>`; `inputs/dollar.html` → `type="dollar"`).
- **`fragments/`** holds page chrome reused across layouts; **`nodes/`** holds the building
  blocks the generator stitches together per Flow XML element.

---

## 3. Fragments and layouts

Reuse chrome with `th:replace` / `th:insert`; pass data with fragment parameters.

```html
<!-- simple include -->
<div th:replace="fragments/head"></div>
<div th:replace="fragments/usa-banner"></div>

<!-- parameterized fragment; ~{:: localFragment} passes a local block as the footer -->
<div th:replace="~{nodes/modal-dialog :: modal(
        modalId=${removeModalId},
        modalHeading=#{components.fg-collection.remove-item-modal.heading},
        modalContent=#{components.fg-collection.remove-item-modal.content},
        footerContent=~{:: removeItemModalFooter}
)}"></div>

<!-- a fragment can compose another by its computed name -->
<th th:replace="~{'nodes/inputs/' + ${typeString}}"></th>
```
*— pattern from `nodes/fg-set.html`, `nodes/fg-collection.html`*

- **Do** keep two layouts distinct: `page.html` (progressive, user-facing) and `all-screens.html`
  (dev-only, renders everything — see §9).
- **Do** inject generator output with `th:utext="${pageHtml}"` (the HTML is trusted, generated
  server-side — there is no user-generated content, so XSS surface is nil per ADR-001).

---

## 4. Thymeleaf attribute conventions

| Need | Use | Example |
| --- | --- | --- |
| Localized text | `th:text` / `th:utext` (`#{...}`) | `th:text="#{layout.skip-to-main}"` |
| Dynamic value | `${...}` | `th:text="${languageCode}"` |
| Conditional render | `th:if` / `th:unless` | `th:if="${flags.auditMode}"` |
| Iterate | `th:each` (+ iter status) | `th:each="page, iterStat : ${pages}"` |
| Local variables | `th:with` | scoped collection name/heading derivations |
| Arbitrary attrs | `th:attr` | `th:attr="path=${path}, condition=${condition}"` |
| Conditional class | `th:class` ternary | `th:class="${condition ? '' : 'hidden'}"` |
| Strip wrapper tag | `th:remove="tag"` | unwrap a `<div>` used only to carry `th:utext` |

```html
<!-- set multiple attributes on a custom element at once -->
<fg-set th:attr="path=${path}, inputType=${typeString}, condition=${condition},
                 operator=${operator}, optional=${optional}">
```
*— `nodes/fg-set.html`*

> Note: templates sometimes use a throwaway `<th>` element purely to host a `th:replace` /
> `th:unless` — it is replaced/removed during rendering and never reaches output.

---

## 5. Internationalization (i18n)

Copy lives in YAML message bundles, never in templates:

- `locales/en.yaml`, `locales/es.yaml` — layout / component strings.
- `locales/flow_en.yaml`, `locales/flow_es.yaml` — flow content (generated from Flow XML).

Keys are nested namespaces and are **composed** from path/content variables:

```html
<!-- simple lookup -->
<span th:text="#{components.fg-set.required}"></span>

<!-- key built from a content key + suffix -->
<div th:utext="#{${contentKey} + .question}" th:remove="tag"></div>

<!-- key built from path + option value -->
<span th:text="#{${contentKey} + .options. + ${option.value} + .name}"></span>

<!-- parameterized message ({0}) -->
<span th:text="#{components.fg-collection.buttons.add(${collectionName})}"></span>

<!-- guard an optional key so a missing message doesn't error -->
<p th:if="${#messages.msgOrNull(contentKey + '.modalLink')}"
   th:utext="#{${contentKey} + .modalLink}"></p>
```

- **Do** add both `en` and `es` keys for any new string.
- **Do** use `#messages.msgOrNull(...)` before rendering an optional key.

---

## 6. Custom elements and Fact Graph wiring

Markup declares intent through attributes; the JS (`fg-components.js`) does the wiring.

| Element | Purpose | Key attributes |
| --- | --- | --- |
| `<fg-set>` | Wrap an input; write a fact | `path`, `inputType`, `condition`, `operator`, `optional` |
| `<fg-show>` / `<fg-get>` | Display / read a fact value | `path` |
| `<fg-apply>` | Set a fact to a value | `path`, `value` |
| `<fg-alert>` | Conditional alert | `alert-type`, `condition`, `operator`, `blocking` |
| `<fg-detail>` | Collapsible section | `condition`, `operator`, `open` |
| `<fg-collection>` | Repeating items | `path`, `condition`, `operator`, `disallowEmpty` |
| `<modal-link>` / `<modal-dialog>` | Inline help → modal | `for` / `id` |

```html
<!-- condition + operator drive visibility; the ternary hides it until JS evaluates -->
<fg-alert th:attr="alert-type=${alertType}, condition=${condition}, operator=${operator},
                   blocking=${alertType == 'error'}"
          th:class="${condition ? '' : 'hidden'}">…</fg-alert>
```

- **`condition` + `operator`** express Fact Graph visibility (`isTrue`, `isFalse`,
  `isIncomplete`, `isBlank`, …). They are emitted as attributes and **also consumed by the
  audit/all-screens debug surfaces** to visualize why content shows or hides — so keep them on
  the element even when also mirrored to a `hidden` class.
- **Collection paths** use a `/*/` wildcard (`/jobs/*/isFilerAssignmentSelf`); the JS rewrites
  `*` to a concrete id when an item is added.

---

## 7. Forms and accessibility

The `<fg-set>` wrapper composes a labeled, hinted, validated input. Single-value inputs get a
`<label>`; grouped inputs (radio/checkbox/date) get `<fieldset>` + `<legend>`.

```html
<fg-set th:attr="path=${path}, inputType=${typeString}, condition=${condition},
                 operator=${operator}, optional=${optional}">
  <div class="usa-form-group">
    <th th:unless="${usesFieldset}">
      <span th:replace="~{nodes/question-label}"></span>
      <span th:replace="~{nodes/hint}"></span>
      <span th:replace="~{nodes/modal-link}"></span>
    </th>
    <th th:replace="~{'nodes/inputs/' + ${typeString}}"></th>
  </div>
</fg-set>
```
*— `nodes/fg-set.html`*

```html
<!-- grouped input: fieldset + legend carry the question; (Required) is aria-hidden decoration -->
<fieldset class="usa-fieldset" th:attr="aria-describedby=${hintId}">
  <legend class="usa-legend twe-question">
    <div th:utext="#{${contentKey} + .question}" th:remove="tag"></div>
    <span th:if="${!optional}" aria-hidden="true" class="usa-hint--required"
          th:text="#{components.fg-set.required}"></span>
  </legend>
  <div class="usa-radio">
    <input th:id="${path}+'-yes'" class="usa-radio__input" type="radio" value="true"
           th:name="${path}" th:required="${not optional}" aria-invalid="false"/>
    <label th:for="${path}+'-yes'" class="usa-radio__label"
           th:utext="${trueLabel != null} ? #{${contentKey} + .options.true.name}
                                            : #{components.boolean.yes}"></label>
  </div>
</fieldset>
```
*— `nodes/inputs/boolean.html`*

Accessibility rules in markup:

- **Semantic structure**: `<label>` for single inputs; `<fieldset>` + `<legend>` for groups;
  proper `<h1>…<h5>` hierarchy; landmarks (`<header>`, `<main id="main-content">`, `<footer>`).
- **A skip link** (`<a class="usa-skipnav" href="#main-content">`) is first in the body.
- **Tie hints to inputs** with `aria-describedby=${hintId}`; start inputs `aria-invalid="false"`.
- **`(Required)` is decorative** (`aria-hidden="true"`); actual requiredness is `th:required`.
- **USWDS sprite icons** are `aria-hidden="true" role="img" focusable="false"`.
- **`aria-current="step"`** marks the current step indicator segment; `usa-sr-only` carries
  screen-reader-only text.
- Use `html-validate-disable`/`-enable` comments when a USWDS pattern requires markup the linter
  would otherwise flag — and **state the reason** in the comment.

---

## 8. CSS classes in markup

- Prefer **USWDS component classes** (`usa-button`, `usa-input`, `usa-alert usa-alert--error`,
  `usa-table`, `usa-step-indicator`). Add a TWE class only for what USWDS doesn't cover
  (`twe-question`, `fg-collection__item-template`, `form-actions`, `back-btn--mobile`).
- Toggle visibility with the `hidden` utility class; the page reflows responsively via **container
  queries** on `.app-container` (see the CSS guide §5), so you generally don't need
  viewport-specific markup.

---

## 9. The all-screens layout (dev-only, ADR-004)

`all-screens.html` is a **separate** layout — not the production flow — that renders every field
regardless of conditions so reviewers can see the full form surface. It:

- loops all pages: `<article th:each="page : ${pages}" class="screen">` and injects
  `th:utext="${page.content}"`;
- forces collections non-empty (`disallowempty`), opens every `.fg-detail`, and calls
  `displayConditions()` to annotate conditional content;
- adds an in-page nav (`<aside class="usa-in-page-nav" data-heading-elements="h2 h3">`);
- is served only in local dev at `…/all-screens/index.html`.

Keep it a distinct file so production never accidentally renders all hidden fields (ADR-004).

---

## 10. Page structure (reference skeleton)

```html
<!DOCTYPE html>
<html th:lang="${languageCode}">
  <div th:replace="fragments/head"></div>
  <body th:classappend="${flags.auditMode} ? 'audit-mode'">
    <a class="usa-skipnav" href="#main-content">…</a>
    <div class="app-container">
      <header>…banner + logo + language switcher…</header>
      <main id="main-content">
        <h1>…</h1>
        <div th:replace="fragments/usa-step-indicator"></div>
        <div id="page-content-wrapper" class="hidden">
          <div th:utext="${pageHtml}"></div>           <!-- generated flow content -->
          <div class="form-actions">…Back / Next…</div>
        </div>
      </main>
      <footer th:aria-label="#{layout.title}">…usa-identifier…</footer>
      <template th:replace="fragments/js-templates"></template>
      <div th:replace="~{errors}"></div>
    </div>
    <div th:replace="fragments/audit-panel"></div>      <!-- hidden until enabled -->
    <script type="module" th:if="${flags.auditMode}">  <!-- dev/opt-in only -->
      import { enable } from '…/audit-panel.js'; enable()
    </script>
  </body>
</html>
```

---

## 11. Anti-patterns

- ❌ Hard-coded user-facing copy in templates instead of `#{...}` keys (and missing the `es` translation).
- ❌ Per-question logic in templates that belongs in Flow XML / locale files.
- ❌ Dropping `condition`/`operator` attributes once a `hidden` class is added — the debug surfaces need them.
- ❌ Grouped inputs without `<fieldset>`/`<legend>`; required indicators that aren't `aria-hidden`; hints not tied via `aria-describedby`.
- ❌ Putting all-screens/audit behavior into `page.html` instead of their isolated layout/fragment.
- ❌ Suppressing an `html-validate` rule without a comment explaining why.

---

## 12. Checklist for new templates / markup

- [ ] New element → `nodes/<name>.html`; new input type → `nodes/inputs/<type>.html`; kebab-case filename matches the element.
- [ ] Shared chrome reused via `th:replace`/`th:insert`; parameterized fragments where data varies.
- [ ] All copy via `#{...}` keys with `en` **and** `es` entries; optional keys guarded by `#messages.msgOrNull`.
- [ ] `fg-*` elements carry `path` + `condition`/`operator`; collection paths use the `/*/` wildcard.
- [ ] Labels/legends, `aria-describedby` hints, `aria-invalid="false"`, decorative `(Required)`, skip link, landmarks all present.
- [ ] USWDS classes first; TWE classes only for gaps; visibility via `hidden` + container queries.
- [ ] All-screens/audit concerns stay in their own layout/fragment; lint suppressions are commented.
