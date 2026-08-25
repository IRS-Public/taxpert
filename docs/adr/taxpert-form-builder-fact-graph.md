# ADR: Taxpert vs. Form Builder vs. Fact Graph

This document explains what problems this repository was built to
solve and how it does it.  It is written for an engineer, architect, or technical program
manager who is deciding whether to adopt, contribute to, or fund work on this stack.

The product and design rationale lives in a separate document,
[Why Taxpert](docs/why-taxpert.md). Read it to better understand the user research behind Taxpert,
the design principles, the descriptions of the workspaces and their modes (Experience Explorer's
Product Experience, Path, and Browse All modes, and Fact Explorer), the audiences and roles the tools
serve, the governance model, and future vision. 

Two architecture decision records from the [Tax Withholding Estimator](https://github.com/IRS-Public/tax-withholding-estimator/) are essential pre-reading, and both are quoted throughout. They live
in the examples repository under `tax-withholding-estimator/docs/adr/`:

| Record | What it decided                                                                          |
|---|------------------------------------------------------------------------------------------|
| [ADR-001: TWE 2.0 Architecture](https://github.com/IRS-Public/tax-withholding-estimator/blob/main/docs/adr/001-twe-architecture.md) | The TWE 2.0 architecture: a fact graph, declarative flow XML, and static site generation |
| [ADR-004: Add Internal Debugging Surfaces for TWE Flow Visibility](https://github.com/IRS-Public/tax-withholding-estimator/blob/main/docs/adr/004-internal-debugging-surfaces.md) | That the internal debugging surfaces ship to production, marked internal only            |

Additionally, readers not familiar with modeling business logic as Fact Dictionaries should review [Fact Dictionary 3.1 Informal Specification](https://github.com/IRS-Public/fact-graph/blob/main/docs/fact-dictionary-specification-3.1.md). 

The applications quoted throughout, Credit Assistant, the Tax Withholding Estimator, and Benefits
Enrollment, are the [example applications](https://github.com/IRS-Public/form-builder-examples) and
live in their own repository. For how the pieces fit together
at build time and in the browser, see [architecture.md](../architecture.md).

## Problem Statement

A tax application encodes rules that a legislature and an agency wrote in prose. Sometimes these rules are simple, often they are the accumulation of decades of incremental legislation with high degrees of complexity. 
For instance, eligibility for the
Earned Income Tax Credit depends on filing status, age, residency, investment income, the number and
relationship of qualifying children, and half a dozen phase-out thresholds that change every year.
Withholding depends on a different set of the same kind of rules. 

Developing these types of eligibility determination or calculator applications requires at least two decisions: First, how to model the business logic as a rules engine. Second, how to capture inputs from your end users and funnel them into your rules engine. 
While these decisions seem trivial on paper and in the beginning of development, in practice certain choices do and do not scale well and can create insurmountable amounts of tech debt. This is true for two reasons:

1. Calculation and eligibility rules engines written as procedural code cannot be introspected.
- As TWE ADR-001 states, the older calculators calculated "taxes with procedural JavaScript code" which proved
"difficult to test: intermediate calculations and individual tax rules
cannot be dynamically introspected and verified." 
- Direct File's flow was written in
JSX, and while it is possible to introspect the resulting React tree, "at that point the declarative
representation has been lost and cannot be recreated."
- Updating that application in response to tax law
changes had "long been costly and time-consuming." The Fact Graph ADR makes the same
point about the agency generally: many IRS applications contain hard-coded, application-specific tax
logic that is difficult and error-prone to update. 
- This is not unique to IRS, though the Internal Revenue Code is of course rather complex. The same can be applied to any application or government agency (federal, state, local, etc.) building questionnaire applications that embed complex business logic to determine eligibility or calculate a benefit amount.

2. Conditional logic makes most of the application invisible during review 
- Traditionally, the only way to understand each branch of a calculation or eligibility determination is to know how and why other branches aren't chosen. This domain specific knowledge is expensive to learn, retain, and train.
- Because a fact-graph
driven questionnaire shows fields based on prior answers, most of the form surface is hidden during
ordinary testing. 
- For instance, diagnosing a bug requires an engineer to : a) understand the tax logic and flow logic well enough to construct a user scenario that surfaces the bug; b) use browser dev tools to inspect the fact graph state in `sessionStorage` along with the
  conditions that control field visibility; c) correlate that state with the visible form behavior to confirm the diagnosis; and 4) understand how to read DSL-specific XML (in most cases).

TWE ADR-004 calls this work "brittle and time-consuming, especially for complex bugs that require
multiple steps to reproduce," and notes that it increases the burden on engineers who are writing code, building other features, debugging
and conducting code reviews. It also records a constituency beyond engineering: "external
stakeholders, including Treasury and researchers, also need to review this behavior in realistic
environments."

## Addressing these problems

Taxpert and [Form Builder](https://github.com/IRS-Public/form-builder) are build as a deliberate responses to these problems. 
1. [Form Builder](https://github.com/IRS-Public/form-builder) and [Fact Graph]([Form Builder](https://github.com/IRS-Public/fact-graph)) address the first problem by requiring
both business logic (e.g. tax code) and user interface conditional logic to be stored as data that survives the build, in both cases as DSL specific XML (Fact Dictionary XML and Flow XML). 
2. Taxpert addresses the second problem by requiring the running application to
expose its state to a layer that was written separately from it.


### Form-Builder and Fact Graph: XML-Based DSLs

An application on this stack is defined by two XML formats (Fact Dictionary and Flow) plus locale files and brand CSS. A [Fact
Dictionary](https://github.com/IRS-Public/fact-graph/blob/main/docs/fact-dictionary-specification-3.1.md) describes the tax logic as facts, writable or derived, with dependencies between them. 
Flow XML describes the questionnaire as pages, questions bound to fact paths, gating conditions,
knockouts, collections, and conditional text.

TWE ADR-001 gives the reason for choosing a data format over code: XML keeps the representation available after
the build, which has practical consequences:

- Validation happens at build time. Misspelling `/income` as `/incom` in Flow XML is a build error,
because the parser checks every `fg-*` element against the Fact Dictionary. Binding a `Dollar` fact
to `type="boolean"` is also a build error. Both XML formats additionally validate against RELAX NG
schemas (`FlowConfig.rng` and `FactDictionaryModule.rng`, shipped in the form-builder jar under
`schema/`), which gives editor autocomplete and a CI check through each application's
`make validate-xml`.
- Ordinary XML tooling works OOTB. For instance, ADR-001 demonstrates listing every
dollar input in the flow with a single `xpath` invocation from a terminal.
- One source feeds several outputs. Every generator in the form-builder repository, under
`src/main/scala/gov/irs/formbuilder/generators/`, reads the same parsed flow and the same dictionary:

| Generator | What it emits | What consumes it |
|---|---|---|
| `Website.scala` | The static multi-language site, one directory tree per locale | The browser |
| `AllScreens.scala` | The Browse All page at `/all-screens`, every screen grouped into sections by flow module | The workspace toolbar, mounted over it |
| `FormBuilderGraph.scala` | `resources/form-builder-graph.json`, the Form Graph Model, under `--formBuilderGraph` | Fact Explorer |
| `FlowManifest.scala` | `resources/flow-manifest.json`, per-page gates and knockout paths | `fg-navigator.js`, for one-question-per-screen navigation |
| `AuthorMode.scala` | A static shell whose editable model is fetched from the authoring server | Authors editing the flow in place |

None of these are a separate reimplementation of the flow. The Browse All page cannot drift from the
questionnaire, because it is generated from the same input in the same build. The Fact Explorer
graph cannot describe a flow that does not exist.



### Taxpert: Separating Flow from Inspection 
See [Why Taxpert](docs/why-taxpert.md) to understand the full scope of features that Taxpert provides today. 

An original implementation of Taxpert bundled Flow XML generation with the taxpert workspace UI, however after several iterations they are now considered distinct entities with distinct domains:

- **Form Builder** (`gov.irs::form-builder`, in the
[form-builder](https://github.com/IRS-Public/form-builder) repository): turns Flow
XML plus a Fact Dictionary into a working static site, and it also ships the browser theme and the
flow runtime. This includes the `<fg-set>` / `<fg-collection>` / `<fg-show>` custom elements, the fact
graph bootstrap, navigation, and validation. Those live as classpath resources inside its jar under
`src/main/resources/form-builder/website-static/`, and `FormBuilderAssets.scala` extracts them during
generation. An application gets a styled, working questionnaire from one Scala dependency with no
npm involved.

- **taxpert library** (the `taxpert` npm package, in this repository's `packages/ui/`): the layer
over a running Form Builder application that makes it inspectable. This includes global nav, audit panel, dockable tool panels,
all-screens toolbar, and the Scenario, Display, and Workspace settings modals.

There is no import in either direction. The tools reach the running flow through duck-typed runtime
contracts:

```
     workspace UI (taxpert)                  Form Builder app in the browser
  ┌──────────────────────────┐             ┌────────────────────────────┐
  │ Inspect / Watchlist /    │             │  <fg-set> <fg-collection>  │
  │ Outcome tracker / …      │             │  <fg-show>  …              │
  └────────┬─────────────────┘             └──────────┬─────────────────┘
           │                                          │
   graph-adapter.js  ──── reads window.factGraph ─────┤
   flow-dom.js       ──── reads markup by CSS selector┘

   configure({ nav, tools, determinations, endpoints, apps, flowDom })
           │
           └── the app tells the workspace what it is. The workspace
               never imports from the app or from form-builder
```


The reason to keep taxpert and form-builder distinct is that an import in either direction turns two independently versioned,
independently useful artifacts into one. Data (Form-Builder Flow XML) does not rely on or touch Inspection (Taxpert). It also allows dependencies to be managed separately. Fact Explorer, a React application, consumes the workspace
UI through the same contracts as the Scala applications, and it never touches Form Builder at all.


### What taxpert does not solve (today)

- No server-side persistence. State lives in the browser's
`sessionStorage`.  This follows from the static, unauthenticated
architecture in ADR-001 and is a deliberate trade for the security profile described in
`SECURITY.md`. A user who starts on a phone cannot continue on a laptop, and closing the
session loses the answers unless they were exported.

- No built-in authentication or authorization. There is no identity layer, and there is nowhere to
put one without changing the architecture. Anything requiring an authenticated taxpayer record is out
of scope for this stack as it stands. The workspace has no accounts or logins either, which
[Why Taxpert](../why-taxpert.md) covers under governance.

-The AI features are experimental and need local model infrastructure. `--aiScenarioGeneration`
and `--aiFactExplanation` are off by default in the build flags, and the assistant service expects
Ollama running on the host, plus a ChromaDB index that has to be populated before retrieval returns
anything. The questionnaire runs without any of it, and the chat surface does not appear. See
[`ai-integration.md`](../internals/ai-integration.md) for the current state.