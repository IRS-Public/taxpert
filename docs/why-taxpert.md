# Why Taxpert

This document explains why the technology in this repository exists, what problems it was built to
solve, and why it is open source. It is written for an engineer, architect, or technical program
manager who is deciding whether to adopt, contribute to, or fund work on this stack. It is the
document to forward to a colleague who is skeptical that a declarative questionnaire using the Fact Graph, Form Builder, and Taxpert framework
is worth the trouble.

Two names here are close enough to confuse. **Taxpert** with a capital T is the platform: this
repository together with the Form Builder scaffold, the Fact Graph engine and the applications built
on them. The **`taxpert` package** is the optional npm workspace UI in `packages/ui/`. The rest of
this document uses "the workspace UI" for the package.

The applications quoted throughout — credit-assistant and the Tax Withholding Estimator — are the
[example applications](https://github.com/IRS-Public/form-builder-example) and live in their own repository, as any
Form Builder app does. Nothing in this repository depends on them.

## Related documents

- [`onboarding.md`](./onboarding.md), how to run everything locally
- [`release-status.md`](./release-status.md), component inventory and maturity
- [`architecture.md`](./architecture.md), how the pieces fit together
- [`ai-integration.md`](./ai-integration.md), the LLM surfaces and their limits
- [`deployment.md`](./deployment.md), deployment topologies and CI
- [Root `README.md`](../README.md)

---

## 1. The starting problem

Two problems came first, and they are recorded separately.

**Tax calculation written as procedural code cannot be introspected.** ADR-001, the TWE 2.0
architecture record, states the case directly: the existing Tax Withholding Estimator "calculates
taxes with procedural JavaScript code, an approach [that] has proven difficult to test: intermediate
calculations and individual tax rules cannot be dynamically introspected and verified." Updating that
application in response to tax law changes had "long been costly and time-consuming for the IRS."
The Fact Graph ADR makes the same point about the agency generally: many IRS applications contain
hard-coded, application-specific tax logic that is difficult and error-prone to update.

**Conditional logic makes most of the application invisible during review.** ADR-004 documents the
second problem with unusual precision. Because a Fact Graph driven questionnaire shows fields based
on prior answers, most of the form surface is hidden during ordinary testing. Diagnosing a bug
required an engineer to:

- understand the flow logic well enough to construct a user scenario that surfaces the bug,
- open browser dev tools to inspect the Fact Graph state in `sessionStorage` along with the
  conditions controlling field visibility, and
- correlate that state with the visible form behavior to confirm the diagnosis.

ADR-004 calls this work "brittle and time-consuming, especially for complex bugs that require
multiple steps to reproduce," and notes that it increases the burden on engineers doing both
debugging and code review. It also records a constituency beyond engineering: "external
stakeholders, including Treasury and researchers, also need to review this behavior in realistic
environments."

Those two problems set the shape of everything here. The first says the rules must be data. The
second says the runtime must be openable.

---

## 2. Why declarative flow and facts instead of hand-written application code

An application on this stack is defined by two XML formats plus locale files and brand CSS. A Fact
Dictionary describes the tax logic as facts, writable or derived, with dependencies between them.
Flow XML describes the questionnaire as pages, questions bound to fact paths, gating conditions,
knockouts, collections, and conditional text.

ADR-001 gives the reason for choosing a data format over code. Direct File's flow was written in
JSX, and while it is possible to introspect the resulting React tree, "at that point the declarative
representation has been lost and cannot be recreated." XML keeps the representation available after
the build. The consequences are practical.

**Validation happens at compile time.** Misspelling `/income` as `/incom` in Flow XML is a build
error, because the parser checks every `fg-*` element against the Fact Dictionary. Binding a
`Dollar` fact to `type="boolean"` is also a build error.

**Ordinary XML tooling works.** The flow validates against a RelaxNG schema, which gives editor
autocomplete and a CI check, and it answers XPath queries. ADR-001 demonstrates listing every dollar
input in the flow with a single `xpath` invocation from a terminal.

**One source feeds several outputs.** This is the payoff that is hard to get any other way. Every
generator in `form-builder/src/main/scala/gov/irs/formbuilder/generators/` reads the same parsed flow and
the same dictionary:

| Generator | What it emits | Who reads it |
|---|---|---|
| `Website.scala` | The static multi-language site, one directory tree per locale | Taxpayers |
| `AllScreens.scala` | The all-screens review page, every field grouped by flow module | Content designers, reviewers |
| `FormBuilderGraph.scala` | `form-builder-graph.json`, the Form Graph Model | Fact Explorer |
| `FlowManifest.scala` | `flow-manifest.json`, per-page gates and knockout paths | Client-side navigation in one-question-per-screen mode |
| `AuthorMode.scala` | The shell for the in-app structured flow editor | Authors editing the flow in place |

None of these is a separate reimplementation of the flow. The all-screens page cannot drift from the
questionnaire, because it is generated from the same input in the same build. The Fact Explorer
graph cannot describe a flow that does not exist. `FormBuilderGraph.scala` records that its output is a
contract shared across two repositories, validated on the consumer side by
`packages/fact-explorer/src/model/fgm.js`.

**Non-engineers can read and change it.** ADR-001 lists as a base goal that TWE 2.0 must "have a
specification that can be easily updated, including by non-engineers." Flow XML is a list of
questions with conditions attached. A content designer changing question wording edits the same file
an engineer edits, and the build validates the result.

---

## 3. Why a separate scaffold and a separate workspace

Two libraries carry the shared work, and the split between them is deliberate.

**Form Builder** (`gov.irs::form-builder`, in `/form-builder/`) is the scaffold. It turns Flow XML plus a Fact
Dictionary into a working static site, and it also ships the browser theme and the flow runtime,
meaning the `<fg-set>` / `<fg-collection>` / `<fg-show>` custom elements, the Fact Graph bootstrap,
navigation, and validation, as classpath resources inside its jar. An application gets a styled,
working questionnaire from one Scala dependency with no npm involved.

**The workspace UI** (the `taxpert` npm package, in `packages/ui/`) is the layer over a running
application that makes it inspectable: global nav, audit panel, dockable tool panels, all-screens
toolbar, and the Scenario, Display, and Workspace settings modals.

For a period, both lived in the npm package. That is the problem this split exists to reverse: an
application without the package "has no styling and no working questionnaire," which made the
workspace a hard build dependency of every application and made the documented architecture false.
It also blocked the cookiecutter's `include_taxpert_workspace` toggle from doing what its name
says, because `make copy-shared-ui` vendored the whole package tree and the theme rode along
inside it.

### What the split cost

The plan is explicit about the price. Roughly thirty lines of workspace mount markup now live once
per application rather than once in the library, in `workspace-head.html`, `workspace-enable.html`,
and `workspace-all-screens.html`. Both applications and the cookiecutter carry a copy, which is a
small fork risk.

Delivering the library's browser assets out of a jar also required a mechanism with no precedent in
the repository. Everything else reads individual classpath resources, and walking a resource
directory across both the `file:` case (running under sbt) and the `jar:` case (a released build)
was new code, now in `FormBuilderAssets.scala`.

### What the split bought

An application generated with `include_taxpert_workspace: no` has no dependency on the workspace
package anywhere, no `copy-shared-ui` target, and no root `package.json`. Turning the workspace off
is a file that is not emitted rather than a conditional inside a library template. The library names
no `vendor/taxpert/` path in any template, so it does not encode the file layout of a package it
neither depends on nor versions.

The split also fixed a real defect. Without the workspace, the workspace's `configure()` never ran,
so the storage prefix fell back to a default and two workspace-free applications served from one
origin would collide on the same `sessionStorage` key. The prefix is now a `FormBuilderApp` field
emitted server-side.

### The runtime contract between them

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

`shared/js/graph-adapter.js` describes itself as "the fact-graph port: the only surface taxpert is
allowed to touch on a host's graph," nine functions wide. Its header records why the port exists:
before it, the tools reached straight for `window.factGraph` and whatever the Scala.js bundle
happened to expose, "which is why the package could only ever run on credit-assistant." Any host
that can answer those nine functions gets the whole workspace, whether its graph is the real
Scala.js object, a Vite module, or a fixture in a test.

`shared/js/flow-dom.js` does the same for markup, describing "how a host writes its flow markup,
described rather than assumed," with defaults that reproduce what the hardcoded selectors did. A host
with different markup overrides only the keys that differ.

The reason to hold this line is that an import in either direction turns two independently
versioned, independently useful artifacts into one. Fact Explorer, a React application, consumes the
workspace UI through the same contracts as the Scala applications, and it never touches Form Builder at
all.

---

## 4. Why the tooling is a first-class product

ADR-004 decided the audit panel would ship to production, clearly marked as internal only, rather
than being a development-only console. The reason was that the audiences who need it are not all
engineers with a local checkout. Its drivers list, verbatim in intent: review all possible form
fields and text content, inspect the conditions controlling visibility, track facts to confirm they
are set correctly and see what derived them, import and export the Fact Graph to a file, let
stakeholders and researchers review the behavior, and do all of it with minimal impact on production
code and no impact on the taxpayer experience.

The surfaces that now exist, and who they serve:

| Surface | Where it lives | What it gives, and to whom |
|---|---|---|
| Tool panels (Inspect, Outcome tracker, Watchlist, Overrides) | `packages/ui/src/tool-panels/` | Engineers and QA: hover any question to see the fact behind it, watch a fact change as answers are entered, follow a determination to its outcome, override a date to test time-sensitive rules |
| Audit panel and its modals | `packages/ui/src/audit-panel/` | Everyone: Scenario setup, Display options, Workspace settings, all reachable from the global nav |
| Scenario import and export | `packages/ui/src/audit-panel/js/scenario-modal.js` | Engineers and testers: copy a Fact Graph out of a broken session and attach it to a bug report, paste one in to reproduce it exactly |
| All-screens page | `form-builder/…/templates/all-screens.html` via `AllScreens.scala`, dressed by the workspace toolbar | Content designers and tax subject-matter experts: every field that could ever appear, grouped by flow module, without constructing scenarios by hand |
| Fact Explorer | `fact-explorer/` | Architects, analysts, reviewers: the flow and the dictionary as one interactive graph, with the live application embedded beside it |
| Display conditions | Workspace UI, on both the flow and all-screens | Reviewers: the condition controlling each block or inline fragment, shown in place |

ADR-004 records the concrete effect it expected, and this is the case for treating the tooling as a
product rather than a debug console: content review is faster "because all potentially reachable
fields can be reviewed without manually constructing many different user scenarios," and testing and
debugging are easier "because reviewers can inspect field visibility conditions, fact state, and full
form coverage more directly."

Fact Explorer extends the same idea to structure, and the gap it closes is this: the flow modules
"control what the taxpayer sees, in what order, under what conditions, and which
answers disqualify them. Today this logic is only legible by reading raw XML." The explorer renders
questions, gating chains, knockouts, collections, and conditional text on a spatial canvas, with
typed edges (`binds`, `gates`, `knocks-out`, `displays`, `depends`) connecting the flow layer to the
fact layer.

The isolation rules from ADR-004 are still enforced. The tool panel stylesheet is scoped to the
bundle's own custom elements so it cannot restructure the product page. The audit panel's old
right-side rail is hidden by default, and neither example application declares the flag that would
bring it back. When a Form Builder application detects that it is inside another page's frame, it
stands the workspace chrome down and shows the product view.

---

## 5. Organizational rationale

**A second application demonstrates the reuse.** ADR-001 listed generic reuse as an explicit
non-goal for TWE 2.0: the team would not "make Fact Graph-based webforms generic to non-TWE
applications," though it noted the code was written with that hope in mind. The extraction happened
afterward, and the second
application is the proof it worked. `tax-withholding-estimator/src/main/scala/gov/irs/twe/Main.scala`
is thirty-four lines. Its comment records that this application "used to carry its own copy of the
whole generator, 28 Scala files, 23 of which shared a basename with credit-assistant's and most of
which differed only by their package line." What is left is three registrations, and they exercise
every extension point the scaffold offers:

| Seam | What TWE registers |
|---|---|
| Node types | `fg-withholding-adjustments`, a flow element the scaffold has never heard of |
| Input types | `single-checkbox`, new, and `date`, replacing the built-in |
| Templates | `nodes/inputs/date.html` and two withholding-adjustment templates in the application's own resources |

**Onboarding cost for a new product is bounded.** `cookiecutter form-builder-template` emits flow,
facts, locales, brand CSS, and a `Main.scala`, with five toggles deciding whether the generated
application ships the all-screens page, scenario mode, the workspace, a Fact Explorer descriptor, and
Docker files. A new product starts from a working questionnaire rather than from a build system.

**Reviewability serves oversight as well as engineering.** When the rules are XML,
oversight bodies can read them. A change to a tax threshold is a diff in a fact file, and the
generated site, the review page, and the graph all move with it.

**Vendor and team dependence is reduced.** ADR-001 argues this at length. Its stated goal is an
application "that can be owned and updated by IRS engineers, indefinitely, at low cost to the
agency," and its method is to minimize dependencies: one build system, few stable JVM libraries,
browser technology with backwards compatibility guarantees, and no npm build tooling in the
generated application. Static site generation is described there as "a stable paradigm. As long as
the generator itself is able to run, the website will operate essentially forever." The same ADR is
candid that Scala is not a standard IRS language choice, states plainly that a Java port "could" be
done and is designed to be feasible, and explains why Scala was kept anyway: the Fact Graph is Scala,
and building the site generator in Scala grows the expertise required to maintain the engine.

---

## 6. Why open source

The open source posture already exists in the repository as concrete files. `credit-assistant/` and
`fact-graph/` each carry a `LICENSE.md` placing the work in the United States public domain with a
CC0 1.0 waiver worldwide. `credit-assistant/` additionally carries `GOVERNANCE.md`, `COMMUNITY.md`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`.

**Public verifiability of tax logic.** `CONTRIBUTING.md` states the purpose plainly: "The primary
purpose of this open-source repository is to provide taxpayers with greater transparency into the
logic and assumptions of the EITC Assistant." Declarative rules are what make that transparency
meaningful. A member of the public can read a fact file and see the threshold, and the community
principles in `COMMUNITY.md` include striving "for transparency for algorithms and places we might be
introducing bias."

**Reuse by other jurisdictions and agencies.** [fact-graph's `docs/oss/benefits.md`](https://github.com/IRS-Public/fact-graph/blob/main/docs/oss/benefits.md) makes the
reusability argument the repository has adopted: "The code we create belongs to the public as a part
of the public domain. The code we work on was paid for by the American people... By coding in FOSS,
we help populate a larger commons that cities, states, businesses, and individuals can participate
in." A state revenue department building a credit eligibility screener faces the same problem shape,
and Flow XML plus a Fact Dictionary is a smaller thing to adopt than an application.

**Contribution and review from outside the originating team.** The same document argues that publicly
available source code enables continuous and broad peer review, and that expanding review beyond the
development team increases reliability and security. The Fact Graph itself is evidence that this
chain works. Version 3.0 is in production and published as part of IRS Direct File, and
[`from-3.0-to-3.1.md`](https://github.com/IRS-Public/fact-graph/blob/main/docs/from-3.0-to-3.1.md) describes 3.1 as an expansion of it: converting the
engine into a standalone
library, allowing a Fact Dictionary to be imported directly from XML, adding override of derived
facts for testing, and adding debugging functionality to the library.

**Adoption is unusually cheap because the deployment is static.** The generated site is HTML, CSS,
and a small amount of JavaScript. There is no database, no session store, and no application server.
ADR-001 notes that this "dramatically limits the security profile," since a static site with no
user-generated content is not vulnerable to cross-site scripting, and `SECURITY.md` records that the
application is client-side only, unauthenticated, and stores neither PII nor Federal Tax
Information. Another organization can host the output on any static host.

**Be clear about what is not portable today.** Three limits are real:

- `gov.irs::form-builder:0.1.0-SNAPSHOT` and `gov.irs:factgraph:3.1.0-SNAPSHOT` are published to a local
  Ivy cache with `sbt publishLocal`. They are not on a public artifact repository, so a downstream
  consumer must build both from source first.
- `COMMUNITY.md` states that "as it stands today this repository does not support external
  contributors outside of the IRS," and `CONTRIBUTING.md` describes the repository as read-only for
  members of the public, who are welcome to open issues and, once solicited, draft pull requests.
  The license permits any use, while the contribution channel is currently narrower than that.
- The two example applications encode United States federal tax rules for specific tax years. The
  scaffold, the engine and the workspace are the reusable parts, which is why the applications now
  sit in a repository of their own.

---

## 7. Concrete problems solved

| Problem | How the platform solves it | Where it lives |
|---|---|---|
| Tax rules embedded in procedural code cannot be introspected or tested rule by rule | Rules are a declarative dependency graph of facts with typed values and explicit dependencies, evaluated identically on the JVM and in the browser | `fact-graph/`, `gov.irs:factgraph:3.1.0-SNAPSHOT` |
| A misspelled fact path or a wrongly typed input reaches a user because nothing checked it at build time | Flow XML is validated against the Fact Dictionary and against a RelaxNG schema during generation, and `make validate-xml` runs the schema check in CI | `form-builder/` parser, `flow/FlowConfig.rng`, `facts/FactDictionaryModule.rng` |
| Most fields are hidden behind conditions, so content and behavior cannot be reviewed | The all-screens page renders every field that could appear, grouped by flow module, generated from the same source as the site | `form-builder/…/generators/AllScreens.scala` |
| Reproducing a bug means reconstructing a user's answers by hand | Scenario copy and paste moves a whole serialized Fact Graph between a browser session and a bug report | `packages/ui/src/audit-panel/js/scenario-modal.js` |
| Correlating a visible field with the fact and condition behind it requires dev tools | Inspect, Watchlist, Outcome tracker, and Overrides read the live graph and the rendered markup and show the correspondence in place | `packages/ui/src/tool-panels/` |
| Flow structure, gates, and knockouts are legible only by reading raw XML | Fact Explorer renders the flow and the dictionary as one interactive graph with typed cross-layer edges | `packages/fact-explorer/`, fed by `form-builder/…/generators/FormBuilderGraph.scala` |
| Each new product forks the site generator | The generator is a library, and an application is a `FormBuilderApp` value plus a `FormBuilder.run` call | `form-builder/`, `tax-withholding-estimator/…/twe/Main.scala` |
| Tooling becomes a hard dependency of the product it inspects | The workspace is optional, reached through duck-typed runtime contracts with no import across the boundary | `packages/ui/src/shared/js/graph-adapter.js`, `flow-dom.js`, `form-builder-template/hooks/` |
| Two applications on one origin collide in browser storage | The storage prefix is a `FormBuilderApp` field emitted server-side, so it applies whether or not the workspace is present | `form-builder/` runtime config, `FormBuilderApp.storagePrefix` |
| Starting a new product means recreating a build, a theme, and a runtime | A cookiecutter emits the thin remainder, with five toggles for the optional surfaces | `form-builder-template/` |

---

## 8. What this does not solve

Stated plainly, because a list of strengths alone is not a useful evaluation.

**No server-side persistence, so no cross-device resume.** State lives in the browser's
`sessionStorage`. A taxpayer who starts on a phone cannot continue on a laptop, and closing the
session loses the answers unless they were exported. This follows directly from the static,
unauthenticated architecture in ADR-001 and is a deliberate trade for the security profile described
in `SECURITY.md`.

**No built-in authentication or authorization.** There is no identity layer, and there is nowhere to
put one without changing the architecture. Anything requiring an authenticated taxpayer record is out
of scope for this stack as it stands.

**No browser hot module replacement for the applications.** Static generation means a Scala or
template edit triggers a rebuild and a manual browser refresh. Flow and fact XML edits are not
watched at all in the Docker development setup and need the watch container restarted. Fact Explorer
and the API do have live reload, because they are a Vite application and a uvicorn service.

**The Scala libraries are not on a public artifact repository.** Both are `-SNAPSHOT` versions
published to a local Ivy cache. Building either application from a clean checkout requires running
`sbt publishLocal` in `fact-graph/` and `form-builder/` first. There is no released, versioned
distribution to depend on yet.

**The AI features are experimental and need local model infrastructure.** `aiScenarioGeneration` and
`aiFactExplanation` are off by default in the build flags, and the backend expects Ollama running on
the host, plus a ChromaDB index that has to be populated before retrieval returns anything. The
questionnaire runs perfectly well without any of it, and the chat surface simply does not appear.
See [`ai-integration.md`](./ai-integration.md) for the current state.

**The flow runtime carries little test coverage.** The decoupling plan records that not one of the
workspace package's test files touched the flow runtime when it was moved, and that output diffing
(`make diff-out`) was the only real guard on the migration. That gap has not been closed by the move
itself.

**Two applications are not a large sample.** The extension seams were designed against the second
application's needs. A third product will probably find a seam that is missing, and the honest
expectation is that it gets added rather than worked around.
