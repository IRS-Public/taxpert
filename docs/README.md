# Documentation

Project-level documentation for the Taxpert repository. These documents cover the platform as a
whole, including the example applications, which live in
[their own repository](https://github.com/IRS-Public/form-builder-examples) and are described here as
consumers of this code. Each component also has its own README with build commands and layout,
linked from the root [README.md](../README.md).

## Start here

New to the project, read in this order.

| Order | Document | Read it when you want to know |
|---|---|---|
| 1 | [why-taxpert.md](why-taxpert.md) | Why this exists, what problems it solves, and why it is open source |
| 2 | [architecture.md](architecture.md) | How the pieces fit together, with diagrams of the build pipeline and the browser runtime |
| 3 | [onboarding.md](onboarding.md) | How to get everything running on your machine, every build flag, and the failure modes you are likely to hit |
| 4 | [release-status.md](release-status.md) | What is in this release, how mature each part is, and what is present in the tree without being finished |

## Reference

| Document | Covers |
|---|---|
| [ai-integration.md](ai-integration.md) | Where the LLM surfaces sit today, how to turn them on, their limits, and proposed expansion |
| [deployment.md](deployment.md) | The static path with no backend, the full container stack, and the tradeoffs between them |
| [style-guides/](style-guides/README.md) | Conventions for Thymeleaf templates, CSS, and browser JavaScript |

## Internals

Written for someone about to change the code, and referenced from the source files they describe.
Each one holds the reasoning that would otherwise sit as long comment blocks in the modules.

| Document | Covers |
|---|---|
| [internals/workspace-configuration.md](internals/workspace-configuration.md) | The three-layer config, the schema gate, and the four host ports the workspace reaches through |
| [internals/global-nav.md](internals/global-nav.md) | `<taxpert-global-nav>`: attributes, events, the taxonomy, the tool strip, and the stylesheet's tokens |
| [internals/audit-panel.md](internals/audit-panel.md) | The page-level mount, the three nav dialogs, display options, the screens toolbar, the path cursor, feature flags |
| [internals/tool-panels.md](internals/tool-panels.md) | The dock, layout state, dragging, and the four tool bodies |
| [internals/fact-explorer-internals.md](internals/fact-explorer-internals.md) | The Form Graph Model, the narrowing chain, the engine, the scenario overlay, layout, the live bridge |
| [internals/assistant-service.md](internals/assistant-service.md) | The two agent loops, their tools, the RAG index, and the environment |

A note on names that recur in all six documents. **Taxpert** with a capital T means this repository
and the platform around it. The **`taxpert` package** means the optional npm workspace UI in
[`packages/ui/`](../packages/ui/), which is one component inside it.

## Decision records

Architecture decision records live with the component they describe, so none of them is in this
repository.

| Location | Contents |
|---|---|
| [tax-withholding-estimator/docs/adr/](https://github.com/IRS-Public/form-builder-examples/tree/main/tax-withholding-estimator/docs/adr) | ADR-001 on the overall architecture, ADR-002 on security scanning, ADR-003 on PDF generation, ADR-004 on internal debugging surfaces. They predate the repository split and describe the platform as a whole despite living with one application. |
| [fact-graph/docs/](https://github.com/IRS-Public/fact-graph/tree/main/docs) | The Fact Graph 3.1 decision record, the 3.0 to 3.1 migration notes, and the fact dictionary specification. |

ADR-004 is the origin of the audit panel and the all-screens page. Read it before changing either.

## Component documentation

| Component | README |
|---|---|
| Taxpert workspace UI | [packages/ui/README.md](../packages/ui/README.md) |
| Fact Explorer | [packages/fact-explorer/README.md](../packages/fact-explorer/README.md) |
| Assistant (LLM backend) | [services/assistant/README.md](../services/assistant/README.md) |
| Where to put the applications the tools read | [apps/README.md](../apps/README.md) |
| Fact Graph rules engine | [IRS-Public/fact-graph](https://github.com/IRS-Public/fact-graph) |
| Form Builder scaffold | [IRS-Public/form-builder](https://github.com/IRS-Public/form-builder) |
| New application template | [IRS-Public/form-builder-template](https://github.com/IRS-Public/form-builder-template#readme) |
| Credit Assistant (EITC) | [form-builder-examples/credit-assistant](https://github.com/IRS-Public/form-builder-examples/blob/main/credit-assistant/README.md) |
| Tax Withholding Estimator | [form-builder-examples/tax-withholding-estimator](https://github.com/IRS-Public/form-builder-examples/blob/main/tax-withholding-estimator/README.md) |
| Benefits Enrollment | [form-builder-examples/benefits-enrollment](https://github.com/IRS-Public/form-builder-examples/blob/main/benefits-enrollment/README.md) |

The bottom six rows are separate repositories. The last three are the example applications, carved
out so that nothing in this repository depends on an application. See
[apps/README.md](../apps/README.md) for where to put them, or your own, so the tools can read them.
