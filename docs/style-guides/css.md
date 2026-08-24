# CSS style guide

Conventions for the CSS across the platform: the Form Builder theme, an application's own
stylesheets, and the taxpert workspace package. They were written against the original
Tax Withholding Estimator (TWE) frontend, before the CSS split across repositories, and the
decisions still cited, **ADR-001 (TWE 2.0 Architecture)** and **ADR-004 (Internal Debugging
Surfaces)**, live with the Tax Withholding Estimator, in its repository's `docs/adr/`. The rules
below hold across all three locations. See
[the style guide index](README.md#which-code-each-guide-governs) for exactly which directory each
one applies to.

---

## 1. Philosophy and architecture

TWE 2.0 optimized for *easy tax-logic and content updates* and accepted a more rigid structure,
style, and set of dependencies (ADR-001). The CSS is plain, vendored-USWDS-first, organized
**by feature, not by property type** (there is no `colors.css` or `spacing.css`).

The cascade is layered across repositories now, in a fixed order. An application's own `main.css`
is still the entry point, but most of what it imports arrives vendored from elsewhere:

```css
/* U.S. Web Design System (vendored, npm) */
@import "../vendor/uswds-3.13.0/styles/uswds.min.css";

/* The Form Builder theme: tokens, page layout, and every element the scaffold generates.
   Extracted from the gov.irs::form-builder jar into resources/vendor/form-builder/ at build time. */
@import "../vendor/form-builder/theme/styles/theme.css";

/* The workspace UI, vendored from the taxpert package by make copy-shared-ui */
@import "../vendor/taxpert/global-nav/styles/global-nav.css";
@import "../vendor/taxpert/tool-panels/styles/tool-panels.css";

/* This application's own utilities, generated from its own flow conditions */
@import "utilities/display-conditions.css";
```

`theme.css` in turn imports `variables.css`, then `layout/`, then one file per component under
`components/`. An application still adds its own component files there in its own copy of that
tree, but the tokens themselves and the styling for every scaffold-generated element (questions,
alerts, collections, details, the step indicator) now live once, in the theme, rather than
duplicated byte for byte across applications.

- **Do** add a new component as its own file in `components/`, in whichever tree it belongs to
  (the theme for something every application shares, an application's own tree for something
  only it needs), imported after `variables.css` and after USWDS.
- **Do** keep `audit-panel.css` and the tool panel stylesheets as their own files. They ship from
  the taxpert package and are loaded or toggled separately for the workspace (see section 7).
- **Don't** reorder the cascade so a component imports before `variables.css` (tokens would be
  undefined) or before USWDS (overriding by later specificity would stop working).

---

## 2. Design tokens (`variables.css`)

All colors, spacing, and type sizes are CSS custom properties on `:root`, mirroring the
[USWDS design tokens](https://designsystem.digital.gov/design-tokens/). `variables.css` now lives
once, in the Form Builder theme, rather than in each application. **Route every literal through a
token.** A raw hex or pixel value in a component file is a smell to refactor.

```css
:root {
  /* Theme colors: base, primary, secondary, accent-cool, accent-warm,
     each with -lightest through -darker steps */
  --base-lightest: #f0f0f0;  --base: #71767a;  --base-darkest: #1b1b1b;
  --primary: #005ea2;        --primary-dark: #1a4480;

  /* State colors: info, error, warning, success, disabled */
  --error: #d54309;  --warning: #ffbe2e;  --success: #00a91c;

  /* System tokens, only the few needed */
  --blue-40v: #2491ff;  /* focus outline */

  /* Spacing, rem-based, 16px root */
  --units-05: 0.25rem;  --units-1: 0.5rem;  --units-2: 1rem;  --units-3: 1.5rem;  /* … */

  /* Type scale */
  --font-size-sm: 1rem;  --font-size-10: 1.5rem;  --font-size-12: 2rem;
  --font-sans: Source Sans Pro Web, Helvetica Neue, Helvetica, Roboto, Arial, sans-serif;

  /* Flow-specific spacing tokens */
  --flow-spacing: var(--units-3);                                   /* 24px between flow blocks */
  --flow-spacing--sm: var(--units-1);                               /* 8px */
  --flow-spacing--offset: calc(var(--flow-spacing) + var(--flow-spacing--sm)); /* 32px */
}
```

**Token naming conventions**

| Group | Pattern | Examples |
| --- | --- | --- |
| Color | `--{family}` plus `-lightest` through `-darker` or `-vivid` | `--primary-light`, `--secondary-dark` |
| Semantic color | state name | `--error`, `--warning-lighter`, `--success-dark` |
| Spacing | `--units-{n}`, n approximates rem steps, `05`/`105` are half-steps | `--units-2` (16px), `--units-105` (12px) |
| Type | `--font-size-{name or n}` | `--font-size-sm`, `--font-size-12` |
| Flow layout | `--flow-spacing*` | `--flow-spacing--offset` |

- **Do** layer semantic tokens onto theme tokens (`--info: var(--accent-cool);`) so meaning and
  palette stay in sync.

---

## 3. Naming and selectors

A pragmatic mix: USWDS classes for components, short semantic classes for the rest, BEM only
where a component is genuinely complex.

- **USWDS (`.usa-*`) classes are never redefined.** Override them from your own files by
  specificity or custom properties, adding styles rather than rewriting them.
- **Custom component classes** are short, lowercase, hyphenated: `.logo-banner`, `.back-link`,
  `.form-actions`, `.app-container`.
- **BEM-light (two levels or fewer)** only for compound components: `.audit-panel__content`,
  `.fg-collection__item-template`, `.fg-detail--chevron`. Avoid `.block__el__sub` depth.
- **State variants** read as modifiers, not nested rules: `.alert--warning`, `.back-btn--mobile`.
- **Web Components are styled as elements**, not classes. Condition attributes are styled the same
  way:

  ```css
  fg-set {
    display: block;
    margin: var(--flow-spacing) 0;
    &:last-child { padding-bottom: 0; }
  }
  h2 + fg-set { margin-top: 0; }            /* sibling margin-collapse reset */

  div[condition], p[condition], span[condition] { /* conditional content */ }
  ```
- **Shadow DOM** is styled with `::part()`:
  ```css
  audited-fact::part(fact-term) { font-weight: bold; }
  ```

There are **no CSS Modules or scoped-class hashing**. They do not fit static generation.
Isolation comes from the cascade, nesting, and component-scoped custom properties. The taxpert
package uses the same approach with its own prefix per bundle (`.tgn-*` for the global nav,
`.ttd-`/`.ttp-`/`.ttm-` for the tool panels), so its stylesheets can load beside an application's
own without a build step reconciling class names.

---

## 4. Layout, scoping, and spacing

- **Flexbox** is the default for one-dimensional layout. CSS Grid is used sparingly, reached for
  only when a true two-axis layout earns it.
- **Native CSS nesting** keeps children scoped under their parent and is used throughout.
- **Component-scoped tokens.** Define a `--custom-prop` on the component root for values only it
  needs, for example `--audit-panel-handle-width` on `.audit-panel`.
- **Spacing is always token-based.** `margin: var(--flow-spacing) 0`, `gap: var(--units-1)`, never
  magic numbers. `calc()` composes tokens, as in `--flow-spacing--offset` and the `.no-gap`
  negative-margin reset.
- Constrain reading measure with `max-width: 68ex` on flow prose, matching `.usa-prose`.

---

## 5. Responsive: container queries first (ADR-004)

This is the signature rule of the codebase. Because the audit panel docks beside the form, the
form must reflow to **its container's width, not the viewport.** ADR-004 chose container queries
for the responsive layer.

Establish the container once, then query it by name:

```css
.app-container {
  container-type: inline-size;
  container-name: app;
}

main {
  padding: var(--units-2) var(--units-2) var(--units-6);

  @container app (min-width: 880px) {
    max-width: 800px;
    padding: var(--units-6) var(--units-8) var(--units-8) var(--units-8);
  }
  @container app (min-width: 1024px) { max-width: 954px; }
}
```

- **Do** use `@container app (...)` for anything that should respond to the form's width. That is
  almost everything: typography scale, form actions, spacing.
- **Do** reserve `@media` for genuinely viewport-level concerns, such as the very narrow breakpoint
  where a person must toggle between the workspace panel and the form.
- **Documented exception:** the USWDS **step indicator** still uses `@media`, because it is a
  vendored component whose internal queries an application does not override.

---

## 6. Accessibility in CSS

- **Visible focus**, USWDS-style: a `.25rem` solid `--blue-40v` outline with offset. Use an inset
  offset for handle or resizer controls so the ring stays visible.
  ```css
  &:focus { outline: .25rem solid var(--blue-40v); outline-offset: .25rem; }
  ```
- **Respect reduced motion.** Every animation has a `prefers-reduced-motion` escape hatch:
  ```css
  .usa-modal--dialog { animation: fadeIn .15s ease-in forwards; }
  @media (prefers-reduced-motion: reduce) { .usa-modal--dialog, ::backdrop { animation: none; } }
  ```
- **Contrast is pre-vetted.** Because all colors come from USWDS tokens, combinations are already
  WCAG-checked. Don't introduce custom color pairings without verifying contrast.
- **Hiding.** `.hidden` (`opacity: 0; display: none;`) is for content removed from flow. Transient
  status uses `opacity` or `visibility` so it can animate.

---

## 7. The workspace stylesheets

- `audit-panel.css`, shipped from `packages/ui/src/audit-panel/styles/`, styles the resizable
  workspace surfaces and is **toggled at runtime** through the stylesheet's `disabled` property
  (`document.querySelector('#audit-panel-styles').disabled = false`), so a production build with
  the workspace mounted pays no layout cost until it is enabled.
- The `audit-mode` body class drives the container-query reflow described in section 5, resizing
  `.app-container` as the panel opens.
- `all-screens.css` styles the Browse All and Path Mode review pages, dressed by the taxpert
  screens toolbar.
- **Keep these out of an application's own `main.css`.** They are separate surfaces with their own
  load and toggle paths, per ADR-004's isolation rule.

---

## 8. Comments

Comment **quirks, overrides, and accessibility fixes**, not section dividers.

```css
/* This makes it so if there a conditional fg-set that is hidden before the first h4
   in a fg-collection-item, the h4 does not get the top border and padding */
.fg-collection-item__fields fg-set.hidden:first-child + h5:first-of-type { /* … */ }

/* Override USWDS */
:root:has(.usa-js-modal--active) { scrollbar-gutter: stable; }
```

When you override USWDS or work around a screen-reader quirk (JAWS, for example), **say why** in
the comment so the next person doesn't "clean it up."

---

## 9. Anti-patterns

- Hard-coded hex or pixel values instead of tokens.
- Redefining `.usa-*` rules wholesale instead of overriding by specificity or custom properties.
- Reaching for `@media` when the layout should respond to the form container (`@container app`).
- BEM chains deeper than two levels, or a one-off "scoped" class where a token would do.
- Animations with no `prefers-reduced-motion` fallback, or custom color pairs with unchecked
  contrast.
- Putting workspace or all-screens rules into an application's `main.css`, or a component file
  that imports before `variables.css`.

---

## 10. Checklist for new CSS

- [ ] A new component is its own file, `@import`ed in the right cascade slot, in the theme if a
      second application would want it and in the application's own tree otherwise.
- [ ] All colors, spacing, and type reference tokens. No raw literals.
- [ ] `.usa-*` is overridden, never redefined. Custom classes are short and semantic. BEM is used
      only where warranted.
- [ ] Responsive rules use `@container app (...)`. Any `@media` is justified as viewport-level or
      as the USWDS step indicator.
- [ ] Focus outline is present (`.25rem var(--blue-40v)`). Animations have a
      `prefers-reduced-motion` fallback.
- [ ] Web Components are styled as elements or through `::part()`. Conditional content uses
      `[condition]` selectors.
- [ ] Overrides and accessibility workarounds carry a "why" comment.
- [ ] Workspace and all-screens styling stays in its own stylesheet, not an application's
      `main.css`.
