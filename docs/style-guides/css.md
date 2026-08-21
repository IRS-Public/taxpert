# CSS Style Guide — TWE Frontend

Conventions for the CSS that styles the Tax Withholding Estimator (TWE) / credit-assistant
frontend. Derived from `website-static/styles/` (`main.css`, `variables.css`,
`layout/`, `components/`, `utilities/`, `audit-panel.css`, `all-screens.css`) and the
decisions **ADR-001 (TWE 2.0 Architecture)** and **ADR-004 (Internal Debugging Surfaces)** —
both in the TWE repo under `docs/adr/`.

---

## 1. Philosophy and architecture

TWE optimizes for *easy tax-logic and content updates* and accepts a more rigid structure,
style, and set of dependencies (ADR-001). The CSS is plain, vendored-USWDS-first, organized
**by feature, not by property type** (there is no `colors.css` / `spacing.css`).

`main.css` is the single entry point and defines the cascade order — vendor, then tokens, then
layout, then components, then utilities:

```css
/* U.S. Web Design System (vendor-compiled) */
@import "../vendor/uswds-3.13.0/styles/uswds.min.css";
/* Variables */
@import "variables.css";
/* Layout */
@import "layout/header.css";
@import "layout/main-content.css";
/* Components */
@import "components/alerts.css";
@import "components/buttons.css";
/* ... one file per component ... */
/* Utilities */
@import "utilities/utilities.css";
@import "utilities/display-conditions.css";
```
*— `main.css:1`*

- **Do** add a new component as its own file in `components/` and `@import` it in the correct
  cascade slot (after layout, before utilities).
- **Do** keep `audit-panel.css` and `all-screens.css` as standalone stylesheets — they are
  loaded/toggled separately for the debug surfaces (see §7).
- **Don't** reorder the cascade so a component imports before `variables.css` (tokens would be
  undefined) or before USWDS (you'd lose the ability to override by later specificity).

---

## 2. Design tokens (`variables.css`)

All colors, spacing, and type sizes are CSS custom properties on `:root`, mirroring the
[USWDS design tokens](https://designsystem.digital.gov/design-tokens/). **Route every literal
through a token.** A raw hex or pixel value in a component file is a smell to refactor.

```css
:root {
  /* Theme colors — base / primary / secondary / accent-cool / accent-warm,
     each with -lightest … -darker steps */
  --base-lightest: #f0f0f0;  --base: #71767a;  --base-darkest: #1b1b1b;
  --primary: #005ea2;        --primary-dark: #1a4480;

  /* State colors — info / error / warning / success / disabled */
  --error: #d54309;  --warning: #ffbe2e;  --success: #00a91c;

  /* System tokens — only the few we need */
  --blue-40v: #2491ff;  /* focus outline */

  /* Spacing — rem-based, 16px root */
  --units-05: 0.25rem;  --units-1: 0.5rem;  --units-2: 1rem;  --units-3: 1.5rem;  /* … */

  /* Type scale */
  --font-size-sm: 1rem;  --font-size-10: 1.5rem;  --font-size-12: 2rem;
  --font-sans: Source Sans Pro Web, Helvetica Neue, Helvetica, Roboto, Arial, sans-serif;

  /* TWE-specific spacing tokens */
  --flow-spacing: var(--units-3);                                   /* 24px between flow blocks */
  --flow-spacing--sm: var(--units-1);                               /* 8px */
  --flow-spacing--offset: calc(var(--flow-spacing) + var(--flow-spacing--sm)); /* 32px */
}
```
*— `variables.css`*

**Token naming conventions**

| Group | Pattern | Examples |
| --- | --- | --- |
| Color | `--{family}` + `-lightest…-darker`/`-vivid` | `--primary-light`, `--secondary-dark` |
| Semantic color | state name | `--error`, `--warning-lighter`, `--success-dark` |
| Spacing | `--units-{n}` (n = rem×… ; `05`/`105` = half-steps) | `--units-2` (16px), `--units-105` (12px) |
| Type | `--font-size-{name|n}` | `--font-size-sm`, `--font-size-12` |
| TWE flow | `--flow-spacing*` | `--flow-spacing--offset` |

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
- **BEM-light (≤ 2 levels)** only for compound components: `.audit-panel__content`,
  `.fg-collection__item-template`, `.fg-detail--chevron`. Avoid `.block__el__sub` depth.
- **State variants** read as modifiers, not nested rules: `.alert--warning`, `.back-btn--mobile`.
- **Web Components are styled as elements**, not classes — and so are condition attributes:

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

There are **no CSS Modules or scoped-class hashing** — they don't fit static generation.
Isolation comes from the cascade, nesting, and component-scoped custom properties.

---

## 4. Layout, scoping, and spacing

- **Flexbox** is the default for one-dimensional layout; CSS Grid is used sparingly. Reach for
  Grid only when a true two-axis layout earns it.
- **Native CSS nesting** keeps children scoped under their parent and is used throughout.
- **Component-scoped tokens**: define a `--custom-prop` on the component root for values only it
  needs (e.g. `--audit-panel-handle-width` on `.audit-panel`).
- **Spacing is always token-based** — `margin: var(--flow-spacing) 0`, `gap: var(--units-1)` —
  never magic numbers. `calc()` composes tokens (`--flow-spacing--offset`, the `.no-gap`
  negative-margin reset).
- Constrain reading measure with `max-width: 68ex` on flow prose, matching `.usa-prose`.

---

## 5. Responsive: container queries first (ADR-004)

This is the signature rule of the codebase. Because the audit panel docks beside the form, the
form must reflow to **its container's width, not the viewport.** ADR-004 converted the
responsive layer to container queries.

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
*— `layout/main-content.css:5`*

- **Do** use `@container app (...)` for anything that should respond to the form's width — which
  is almost everything (typography scale, form actions, spacing).
- **Do** reserve `@media` for genuinely viewport-level concerns (e.g. the very narrow breakpoint
  where the user must toggle between panel and form).
- **Documented exception:** the USWDS **step indicator** still uses `@media` because it's a
  vendored component whose internal queries we don't override.

---

## 6. Accessibility in CSS

- **Visible focus**, USWDS-style: a `.25rem` solid `--blue-40v` outline with offset. Use an inset
  offset for handle/resizer controls so the ring stays visible.
  ```css
  &:focus { outline: .25rem solid var(--blue-40v); outline-offset: .25rem; }
  ```
- **Respect reduced motion** — every animation has a `prefers-reduced-motion` escape hatch:
  ```css
  .usa-modal--dialog { animation: fadeIn .15s ease-in forwards; }
  @media (prefers-reduced-motion: reduce) { .usa-modal--dialog, ::backdrop { animation: none; } }
  ```
- **Contrast is pre-vetted**: because all colors come from USWDS tokens, combinations are already
  WCAG-checked. Don't introduce custom color pairings without verifying contrast.
- **Hiding**: `.hidden` (`opacity: 0; display: none;`) for removed-from-flow content; transient
  status uses `opacity`/`visibility` so it can animate.

---

## 7. The debug-surface stylesheets

- `audit-panel.css` styles the resizable side panel and is **toggled at runtime** via the
  stylesheet's `disabled` property (the JS flips `#audit-panel-styles.disabled`), so production
  pays no layout cost until audit mode is enabled.
- The `audit-panel-open` body state switches `.app-container` to `width: calc(100vw - var(--audit-panel-width, 38vw))`,
  driving the container-query reflow described in §5.
- `all-screens.css` styles the dev-only review page.
- **Keep these out of `main.css`.** They are separate surfaces with their own load/toggle paths
  (ADR-004 isolation).

---

## 8. Comments

Comment **quirks, overrides, and accessibility fixes** — not section dividers.

```css
/* This makes it so if there a conditional fg-set that is hidden before the first h4
   in a fg-collection-item, the h4 does not get the top border and padding */
.fg-collection-item__fields fg-set.hidden:first-child + h5:first-of-type { /* … */ }

/* Override USWDS */
:root:has(.usa-js-modal--active) { scrollbar-gutter: stable; }
```

When you override USWDS or work around a screen-reader (e.g. JAWS) quirk, **say why** in the
comment so the next person doesn't "clean it up."

---

## 9. Anti-patterns

- ❌ Hard-coded hex/px values instead of tokens.
- ❌ Redefining `.usa-*` rules wholesale instead of overriding by specificity / custom props.
- ❌ Reaching for `@media` when the layout should respond to the form container (`@container app`).
- ❌ BEM chains deeper than two levels, or a one-off "scoped" class where a token would do.
- ❌ Animations with no `prefers-reduced-motion` fallback; custom color pairs with unchecked contrast.
- ❌ Putting audit/all-screens rules in `main.css`, or a component file that imports before `variables.css`.

---

## 10. Checklist for new CSS

- [ ] New component is its own file under `components/`, `@import`ed in the right cascade slot.
- [ ] All colors/spacing/type reference tokens from `variables.css`; no raw literals.
- [ ] `.usa-*` overridden, never redefined; custom classes short + semantic; BEM only where warranted.
- [ ] Responsive rules use `@container app (...)`; any `@media` is justified (viewport-level / USWDS step indicator).
- [ ] Focus outline present (`.25rem var(--blue-40v)`); animations have a `prefers-reduced-motion` fallback.
- [ ] Web Components styled as elements / `::part()`; conditional content via `[condition]` selectors.
- [ ] Overrides and a11y workarounds carry a "why" comment.
- [ ] Audit/all-screens styling stays in its own stylesheet, not `main.css`.
