# Internals: the global nav

`<taxpert-global-nav>` is the bar across the top of every workspace host. It renders a waffle
button, a breadcrumb, a strip of tool buttons, and a dropdown holding the workspace toggle and the
navigation taxonomy.

The bundle is `packages/ui/src/global-nav/`.

| File | Holds |
|---|---|
| `js/taxpert-global-nav.js` | The custom element |
| `js/nav-menu-data.js` | The taxonomy's shape and the helpers that read it |
| `js/templates.js` | The bundle's template loader |
| `templates/global-nav.html` | The markup, as `<template>` elements |
| `styles/global-nav.css` | Everything it looks like |

It is a vanilla custom element in light DOM with no shadow root, so it renders natively in
credit-assistant, which has no build tools, and inside React and Vite in Fact Explorer.

`global-nav.css` is the one stylesheet every workspace host loads, which is why it `@import`s
`shared/styles/embedded.css`.

## Rendering, once

The markup is cloned in once on connect. Every state change after that moves an attribute,
`aria-expanded`, `aria-checked`, `aria-current` or `hidden`, and the stylesheet decides what that
looks like.

Nothing is torn down and rebuilt. A collapsed group's children still exist in the DOM, which is what
lets the stylesheet mark the group you are in with `:has(.tgn-item[aria-current])` rather than a
class the JavaScript has to remember to set.

The `<use href="#tgn-icon-…">` sprite goes into the document once per page rather than once per nav,
because those references resolve against the document.

## Attributes and properties

Attributes are configuration and are read once, when the element connects. There is no
`observedAttributes` or `attributeChangedCallback`, which is the codebase pattern
(`docs/style-guides/javascript.md`). Anything that changes afterwards changes through a property,
and each setter does the one targeted update it implies.

| Attribute | Meaning |
|---|---|
| `app` | The host application's id. Falls back to `config.app.id` |
| `active` | The current destination id |
| `workspace-label` | The dropdown's toggle row label. Defaults to `TAXPERT WORKSPACE` |
| `workspace-on` | `"true"` or `"false"` |
| `workspace-locked` | `"true"` pins the workspace on and makes the toggle inert |
| `context-label` | Overrides the breadcrumb's context half |
| `menu-json` | A JSON taxonomy override |
| `templates-base` | Where to fetch the bundle's markup from |

| Property | Notes |
|---|---|
| `ready` | Resolves once the bar has been cloned in |
| `menu` | An array override. Wins over `menu-json` and `config.nav.menu`, and rebuilds the taxonomy |
| `active` | The current destination id |
| `app` | Mirrored to `data-app` on the host, so a page can find or style one application's nav |
| `workspaceOn` | Whether the workspace is on |

A host may assign one of these properties before this module has run, because script order is the
host's business. `_upgradeProperty()` handles that. Without it the assignment sticks as an own
property and shadows the accessor permanently.

### `workspace-locked`

Pinning the workspace on suits a host where "workspace off" is not a meaningful state. Fact
Explorer's whole application is a Taxpert Workspace destination, so it locks the toggle rather than
tracking a per-host on/off preference and handing it across a cross-origin navigation.

## Events

All three bubble and are composed.

| Event | Detail | Notes |
|---|---|---|
| `nav-select` | `{ id, href, action }` | Cancelable. A host may `preventDefault()` and handle it in-app. Items with an `href` otherwise navigate natively |
| `workspace-toggle` | `{ on }` | Not dispatched while `workspace-locked` |
| `nav-tool-select` | `{ id }` | A tool button in the bar, or the workspace row's settings gear |

The nav owns no tool UI of its own. Whoever provides the surface listens for `nav-tool-select`:
`<taxpert-scenario-modal>` for `scenario`, `<taxpert-display-modal>` for `display`,
`<taxpert-tools-modal>` for `tools`, and `<taxpert-workspace-settings-modal>` for
`workspace-settings`.

Three of those four arrive with the audit panel, which creates them. The gear is the exception
worth knowing about: it is in the workspace row rather than the tool strip, so it is present on
hosts that mount no panel, and `workspace-settings-modal.js` mounts itself on demand there. See
[audit-panel.md](audit-panel.md#the-three-dialogs-self-wire).

## The taxonomy

The taxonomy is the host's, at `config.nav.menu`, not this package's. It was once a `DEFAULT_MENU`
constant here, which meant the shared nav shipped with one application's deployed route prefix and
another's dev-server origin baked in.

Each leaf carries:

| Key | Meaning |
|---|---|
| `href` | The real destination. The menu renders as real `<a>` links, so navigation works before and without JavaScript |
| `action` | Optional marker letting a host intercept the item and handle it in-app instead of navigating. Hosts may also intercept by `id` |
| `disabled` | Optional. A destination that does not exist yet |
| `ff` | Optional feature-flag kebab name gating visibility |

An `ff` leaf is always rendered and stays a real `<a>`, so nothing about click handling changes.
`shared/styles/feature-flags.css` hides it until `<body>` carries the matching `ff-<kebab>` class,
the same `data-ff` convention `feature-flags.js` uses elsewhere.

Every helper in `nav-menu-data.js` defaults its `menu` argument by calling `getConfig()` rather than
by closing over a constant, so the default is whatever is configured at the moment of the call.

### Groups are accordions

A group opens itself when it holds the destination you are on. Arriving on Path Mode should show you
the mode you are in and its siblings. From anywhere else the modes are detail about a place you are
not, so the group stays shut until asked. An explicit toggle wins from then on.

`_groupOpen` is a `Map` of group id to the choice a person made. Absent means the group is still
following the active destination. It lives in the element rather than the DOM, which is why
rebuilding the taxonomy on a config change does not lose an opened group.

## The tool strip

Which tool buttons the bar offers, and where each applies, is `config.nav.toolsByDestination`.

```js
configure({
  nav: {
    toolsByDestination: [
      { id: 'scenario', label: 'Scenario', icon: 'tune', destinations: ['product-experience'] },
    ],
  },
})
```

`id` is what `nav-tool-select` carries. `icon` is the stem of a `#tgn-icon-…` sprite id.
`destinations` are menu-item ids, and a button hides itself anywhere else. CSS hides the whole strip
once every button in it is hidden.

This was three module-scope arrays in the element, which is how the shared nav came to know that
Fact Explorer has a destination called `fact-explorer`. The host knows where its own tools apply, so
the host says.

## The breadcrumb

The breadcrumb reads `<brand> | <context>`, and the context half exists only while the workspace is
on. With the workspace off the nav reverts to just the brand.

The context is the `context-label` attribute when a host sets one, for a location that is not a menu
destination, and otherwise is derived from the active menu item. For a leaf inside a group it is the
group's label.

## Re-rendering on a config change

The taxonomy and the tool strip both come from the configuration, and a host may configure after the
bar has rendered, because the templates arrive over a fetch and which of the two wins is a race. The
element listens for `CONFIG_CHANGE_EVENT` and rebuilds both from scratch.

Rebuilding is safe because neither carries state a person set. An opened group is remembered in
`_groupOpen`, not in the DOM.

## Templates and layout shift

`js/templates.js` starts the fetch at import time so it is in flight before the element upgrades.
The nav ships in production and is the first thing on the page, so hosts should also preload it.
credit-assistant does, in `fragments/head.html`.

`global-nav.css` reserves the bar's height on `:root` so nothing shifts when the markup lands. The
height is published as a custom property rather than set on the element, because the thing that
needs to know it is the page underneath.

## The stylesheet

Every class is prefixed `.tgn-` and every token `--tgn-`, so one stylesheet renders identically in
either host.

Neutrals and metrics chain to the host's own design tokens with a hard-coded fallback, so neither
host is a hard dependency. credit-assistant supplies `--primary` and `--units-*`, Fact Explorer
supplies `--color-*` and `--space-*`. The token rule sits inside `:where()`, at zero specificity, so
a host can override any of them.

### The brand colors deliberately do not chain

`--tgn-accent` is a fixed `#5e10a6`. Chaining it through a host's generic `--color-accent` or
`--primary` meant the nav picked up whatever color the host themed itself with, USWDS blue in the
Form Builder apps and a different purple in Fact Explorer, instead of rendering the same Taxpert
purple everywhere. Those tokens are each host's own brand for its buttons and links, not Taxpert's.

A host that wants to retheme the chrome on purpose still can, by setting `--tgn-accent` itself with
any real specificity.

`--tgn-on`, the workspace toggle's checked fill and the bar's focus rings, chains to `--tgn-accent`
for the same reason. The toggle sits 12px from the purple settings gear in the same row, so a
host-blue pill there read as two brands in one control.

| Token | Why it is what it is |
|---|---|
| `--tgn-accent` | Taxpert purple. Fixed, per above |
| `--tgn-ink` | Pure black, for the wordmark row and the dropdown's group and leaf rows. Separate from `--tgn-text`, which still chains to the host's body-text token, because these surfaces are the nav's own typography rather than borrowed body copy |
| `--tgn-bar-border` | The rule under the bar. The generic border token, a near-lavender, disappeared between the bar's pale lavender and the white band beneath it, so the chrome ran into the page with no edge. This is the neutral USWDS `--base-light` the rest of the workspace draws hairlines in |
| `--tgn-menu-active` | A tint of the brand purple, not the purple itself. See below |
| `--tgn-bar` | The same pale lavender as `--tgn-menu-active`, written out rather than chained. One design, two surfaces, and a retint of the selected row should not repaint the whole bar |
| `--tgn-z` | `1000`. Below credit-assistant's modals at 1050, above Fact Explorer's overlays |
| `--tgn-font` | Source Sans Pro, the Taxpert type family, with the family named directly in the fallbacks so a host that does not vendor it lands on the same design |

`--tgn-menu-active` is a tint because taking the written spec literally is unreadable. The spec gives
the selected-menu color as the brand purple, but black on it is about 1.4:1, far under the 4.5:1
floor, and the purple check mark would vanish into its own background. The tint keeps the design's
reading at 17:1 for the label and 8:1 for the check.

`<taxpert-workspace-settings-modal>` pins its section accordions to the same fill
(`--twsm-section-bg`). The two are meant to be one surface, so move them together.

### Sticky positioning

The bar is pinned to the top of the scroll, so the workspace chrome stays reachable however far down
a flow you are. A long Browse All listing is thousands of pixels of product with no other way back.

Sticky is on the host element rather than on `.tgn-bar` inside it. A sticky box is bounded by its
parent's, and `.tgn-bar` fills the host exactly, so sticking it there would give it nothing to
travel through. For the same reason the scaffold's page templates mount the element as a direct
child of the scrolling container rather than inside the product's `<header>`.

`z-index: var(--tgn-z)` keeps the product's own stacking from drawing over a bar that no longer
scrolls away. It also makes the element a stacking context, so `.tgn-menu` cannot out-stack anything
outside it, which is why the tool dock's float layer sits above `--tgn-z` rather than between the bar
and its dropdown.

### `--tgn-bar-height`

Published on `:root` rather than on the element, because the thing that needs it is not the nav.
`<taxpert-screens-toolbar>` sticks underneath the pinned nav and has to know how far down that is,
and the two are siblings, so a token scoped to the nav would never reach it.

It is a declared length rather than a measured one, because the bar's height is fixed by its own
metrics (12px padding twice, plus the 32px waffle, plus the 1px bottom border), which is the same
arithmetic the `min-height` states. A `ResizeObserver` would be a subscription to a number that does
not change.

A host with no nav on the page gets whatever fallback each reader supplies, so the toolbar pins to
the top rather than to a gap.

## Gotchas

| Watch out for | Why |
|---|---|
| Adding an `observedAttributes` hook | Attributes are read once by design. Add a property setter instead |
| Setting a `--selected` or `--active` class | Visual state is a CSS selector on an attribute the JS already sets |
| Removing a collapsed group's children from the DOM | `:has(.tgn-item[aria-current])` needs them present to tint the group |
| Hardcoding a destination id in this bundle | Destinations are the host's. Put it in `nav.toolsByDestination` or the menu |
| Expecting `workspaceOn` to change while locked | The setter returns early, and no event is dispatched |
