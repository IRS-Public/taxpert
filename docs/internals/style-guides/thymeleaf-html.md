# HTML and Thymeleaf style guide

Conventions for the Thymeleaf templates and generated HTML across the platform: the Form Builder
scaffold's own templates and an application's overrides of them. They were written against the
original Tax Withholding Estimator (TWE) frontend, before the scaffold split into its own
repository, and the decisions still cited, **ADR-001 (TWE 2.0 Architecture)** and **ADR-004
(Internal Debugging Surfaces)**, live with the Tax Withholding Estimator, in its repository's
`docs/adr/`. The conventions still hold. See
[the style guide index](README.md#which-code-each-guide-governs) for which directory each one
applies to.

---

## 1. Philosophy: Flow XML in, HTML out

A Form Builder application is a static-site generator. Tax-logic engineers write **Flow XML**
("questions"). The Scala generator transforms it into HTML using a small set of `fg-*` custom
elements that bridge form inputs to the Fact Graph. Plain HTML passes through untouched (ADR-001):

> The generated static HTML largely consists of `<fg-set>` custom elements, which enhance HTML
> form inputs with the ability to set values in a fact graph … Everything else, the regular HTML
> elements, will get passed through, unmodified, to the static output.

The implications for templates:

- **Do** put per-question content and logic in **Flow XML** and the YAML locale files, not in the
  templates. Templates are the reusable rendering layer.
- **Do** add a `nodes/` template when you need a new custom element, or a `nodes/inputs/`
  template for a new input type.
- **Don't** bake user-facing copy into a template. It belongs in a `#{...}` message key.

---

## 2. Template organization and app-first resolution

The templates themselves live in the scaffold, under
`form-builder/src/main/resources/form-builder/templates/`:

```
templates/
  page.html              main, user-facing flow layout
  all-screens.html       the Browse All / Path Mode review layout (renders every field)
  author-mode.html       the Author Mode editing shell
  errors.html            client error-message templates
  fragments/             shared page chrome, including the four workspace mount points
    head.html  usa-banner.html  usa-step-indicator.html  js-templates.html  lock.html
    app-head.html  audit-panel.html
    workspace-head.html  workspace-enable.html  workspace-all-screens.html  taxpert-config.html
  nodes/                 one template per custom element
    fg-set.html  fg-alert.html  fg-detail.html  fg-collection.html
    fg-apply.html  fg-section-gate.html  modal-dialog.html  modal-link.html
    question-label.html  hint.html  section.html
    inputs/               one template per input type
      text.html  dollar.html  int.html  date.html  boolean.html  enum.html  multi-enum.html  select.html
```

An application resolves its own `templates/` first and the scaffold's second, per file name, so it
overrides exactly the templates it needs to and inherits the rest untouched. Tax Withholding
Estimator's `nodes/inputs/date.html` override and its two `fg-withholding-adjustments-*.html`
node templates are the working example. See
[architecture.md](../../architecture.md#5-the-five-extension-points) for the resolver mechanics.

- **Filenames are `kebab-case` and match the element or concept** they render (`fg-set.html`
  renders `<fg-set>`, `inputs/dollar.html` renders `type="dollar"`).
- **`fragments/`** holds page chrome reused across layouts. **`nodes/`** holds the building
  blocks the generator stitches together per Flow XML element.

---

## 3. Fragments and layouts

Reuse chrome with `th:replace` or `th:insert`. Pass data with fragment parameters.

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

*Pattern from `nodes/fg-set.html`, `nodes/fg-collection.html`.*

- **Do** keep the layouts distinct: `page.html` (progressive, user-facing) and `all-screens.html`
  (renders everything, for review, see section 9).
- **Do** inject generator output with `th:utext="${pageHtml}"`. The HTML is trusted and generated
  server-side. There is no user-generated content, so ADR-001 treats the XSS surface as nil.

---

## 4. Thymeleaf attribute conventions

| Need | Use | Example |
| --- | --- | --- |
| Localized text | `th:text` or `th:utext` (`#{...}`) | `th:text="#{layout.skip-to-main}"` |
| Dynamic value | `${...}` | `th:text="${languageCode}"` |
| Conditional render | `th:if` or `th:unless` | `th:if="${flags.auditMode}"` |
| Iterate | `th:each`, with iteration status | `th:each="page, iterStat : ${pages}"` |
| Local variables | `th:with` | scoped collection name or heading derivations |
| Arbitrary attrs | `th:attr` | `th:attr="path=${path}, condition=${condition}"` |
| Conditional class | `th:class` ternary | `th:class="${condition ? '' : 'hidden'}"` |
| Strip wrapper tag | `th:remove="tag"` | unwrap a `<div>` used only to carry `th:utext` |

```html
<!-- set multiple attributes on a custom element at once -->
<fg-set th:attr="path=${path}, inputType=${typeString}, condition=${condition},
                 operator=${operator}, optional=${optional}">
```

*`nodes/fg-set.html`.*

Templates sometimes use a throwaway `<th>` element purely to host a `th:replace` or `th:unless`.
It is replaced or removed during rendering and never reaches output.

---

## 5. Internationalization (i18n)

Copy lives in YAML message bundles, never in templates, resolved app-first over the scaffold's own
chrome strings, over the generated flow content:

- An application's own `locales/en.yaml`, `locales/es.yaml`, and so on: layout and component
  strings for its own words.
- The scaffold's `locales/{lang}.yaml`, on the classpath: chrome shared by every application
  (`components.*`, `workspace.tools.*`).
- The generated `locales/flow_{lang}.yaml`: flow content, produced from Flow XML. Never hand-edit
  this file.

Keys are nested namespaces and are **composed** from path or content variables:

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

- **Do** add every locale an application ships for any new string.
- **Do** use `#messages.msgOrNull(...)` before rendering an optional key.

---

## 6. Custom elements and Fact Graph wiring

Markup declares intent through attributes. The flow runtime's JavaScript
(`form-builder/.../website-static/flow-runtime/js/`) does the wiring.

| Element | Purpose | Key attributes |
| --- | --- | --- |
| `<fg-set>` | Wrap an input, write a fact | `path`, `inputType`, `condition`, `operator`, `optional` |
| `<fg-show>` / `<fg-get>` | Display or read a fact value | `path` |
| `<fg-apply>` | Set a fact to a value | `path`, `value` |
| `<fg-alert>` | Conditional alert | `alert-type`, `condition`, `operator`, `blocking` |
| `<fg-detail>` | Collapsible section | `condition`, `operator`, `open` |
| `<fg-collection>` | Repeating items | `path`, `condition`, `operator`, `disallowEmpty` |
| `<modal-link>` / `<modal-dialog>` | Inline help, opening a modal | `for` / `id` |

```html
<!-- condition + operator drive visibility; the ternary hides it until JS evaluates -->
<fg-alert th:attr="alert-type=${alertType}, condition=${condition}, operator=${operator},
                   blocking=${alertType == 'error'}"
          th:class="${condition ? '' : 'hidden'}">…</fg-alert>
```

- **`condition` and `operator`** express Fact Graph visibility (`isTrue`, `isFalse`,
  `isIncomplete`, `isBlank`, and so on). They are emitted as attributes and are also read by the
  taxpert workspace's Inspect and Display tools to show why content shows or hides. Keep them on
  the element even when also mirrored to a `hidden` class.
- **Collection paths** use a `/*/` wildcard (`/jobs/*/isFilerAssignmentSelf`). The flow runtime
  rewrites `*` to a concrete id when an item is added.

---

## 7. Forms and accessibility

The `<fg-set>` wrapper composes a labeled, hinted, validated input. Single-value inputs get a
`<label>`. Grouped inputs (radio, checkbox, date) get `<fieldset>` and `<legend>`.

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

*`nodes/fg-set.html`.*

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

*`nodes/inputs/boolean.html`.*

Accessibility rules in markup:

- **Semantic structure.** `<label>` for single inputs, `<fieldset>` and `<legend>` for groups, a
  proper `<h1>` through `<h5>` hierarchy, and landmarks (`<header>`, `<main id="main-content">`,
  `<footer>`).
- **A skip link** (`<a class="usa-skipnav" href="#main-content">`) is first in the body.
- **Tie hints to inputs** with `aria-describedby=${hintId}`. Start inputs `aria-invalid="false"`.
- **`(Required)` is decorative** (`aria-hidden="true"`). Actual requiredness is `th:required`.
- **USWDS sprite icons** are `aria-hidden="true" role="img" focusable="false"`.
- **`aria-current="step"`** marks the current step indicator segment. `usa-sr-only` carries
  screen-reader-only text.
- Use `html-validate-disable` and `-enable` comments when a USWDS pattern requires markup the
  linter would otherwise flag, and **state the reason** in the comment.

---

## 8. CSS classes in markup

- Prefer **USWDS component classes** (`usa-button`, `usa-input`, `usa-alert usa-alert--error`,
  `usa-table`, `usa-step-indicator`). Add an application-specific class only for what USWDS
  doesn't cover (`twe-question`, `fg-collection__item-template`, `form-actions`,
  `back-btn--mobile`).
- Toggle visibility with the `hidden` utility class. The page reflows responsively through
  **container queries** on `.app-container` (see the [CSS guide](css.md), section 5), so
  viewport-specific markup is rarely needed.

---

## 9. The all-screens layout (Browse All and Path Mode, ADR-004)

`all-screens.html` is a **separate** layout, not the production flow, that renders every field
regardless of conditions so reviewers can see the full form surface.

- It loops all pages, `<article th:each="page : ${pages}" class="screen">`, and injects
  `th:utext="${page.content}"`.
- It forces collections non-empty (`disallowempty`), opens every `.fg-detail`, and calls
  `displayConditions()` to annotate conditional content.
- It adds an in-page nav (`<aside class="usa-in-page-nav" data-heading-elements="h2 h3">`).
- It is generated only under the `--allScreens` build flag, and is dressed by taxpert's
  `<taxpert-screens-toolbar>` rather than by anything in the scaffold's own templates.

Keep it a distinct file so a production build never accidentally renders every hidden field
(ADR-004).

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
    <div th:replace="fragments/audit-panel"></div>      <!-- an app-owned fragment, empty unless filled -->
    <div th:replace="fragments/workspace-enable :: workspace-enable"></div>  <!-- calls enable(), under --auditMode -->
  </body>
</html>
```

`fragments/head.html` renders the workspace's `workspace-head` and `taxpert-config` fragments
inside its own `${flags.auditMode}` block, ahead of this skeleton. See
[architecture.md](../../architecture.md#4-the-workspace-layer-and-its-contract) for what each of the
four workspace fragments carries.

---

## 11. Anti-patterns

- Hard-coded user-facing copy in templates instead of `#{...}` keys, and a missing translation for
  a locale the application ships.
- Per-question logic in templates that belongs in Flow XML or locale files.
- Dropping `condition` or `operator` attributes once a `hidden` class is added. The workspace's
  Inspect and Display tools need them.
- Grouped inputs without `<fieldset>`/`<legend>`, required indicators that aren't `aria-hidden`,
  or hints not tied through `aria-describedby`.
- Putting all-screens or workspace behavior into `page.html` instead of their own layout or
  fragment.
- Suppressing an `html-validate` rule with no comment explaining why.

---

## 12. Checklist for new templates and markup

- [ ] A new element goes in `nodes/<name>.html`, a new input type in `nodes/inputs/<type>.html`.
      The kebab-case filename matches the element.
- [ ] Shared chrome is reused through `th:replace`/`th:insert`, with parameterized fragments where
      data varies.
- [ ] All copy goes through `#{...}` keys, with every locale the application ships. Optional keys
      are guarded by `#messages.msgOrNull`.
- [ ] `fg-*` elements carry `path` plus `condition`/`operator`. Collection paths use the `/*/`
      wildcard.
- [ ] Labels or legends, `aria-describedby` hints, `aria-invalid="false"`, decorative
      `(Required)`, the skip link, and landmarks are all present.
- [ ] USWDS classes come first. Application-specific classes cover only genuine gaps. Visibility
      uses `hidden` plus container queries.
- [ ] All-screens and workspace concerns stay in their own layout or fragment. Lint suppressions
      are commented.
