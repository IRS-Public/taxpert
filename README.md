# Taxpert

## Overview

Taxpert is a suite of internal tools that helps teams understand and validate the rules and relationships inside
[Form Builder](https://github.com/IRS-Public/form-builder) and
[Fact Graph](https://github.com/IRS-Public/fact-graph) applications. The core component is a 
drop-in UI library that wraps a lightweight workspace around a running application, with several optional extensions.
To build your own Form Builder and Fact Graph application and customize Taxpert to it, start with
[Form Builder Template](https://github.com/IRS-Public/form-builder-template).  To run pre-existing applications that 
incorporate various components of Taxpert already, see
[Form Builder Examples](https://github.com/IRS-Public/form-builder-examples).

Before jumping in, we recommend reviewing [Why Taxpert](docs/why-taxpert.md) to contextualize the problem Taxpert 
addresses, 
supporting user research, and future direction. Other helpful documents include:

| Document | What it covers                                                                        |
|---|---------------------------------------------------------------------------------------|
| [Taxpert vs. Form Builder vs. Fact Graph](docs/adr/taxpert-form-builder-fact-graph.md) | What each of the three libraries owns and why they are separate                       |
| [Release status](docs/release-status.md) | Which capabilities ship today, and how mature each one is                             |
| [Architecture](docs/architecture.md) | How the pieces fit together, with diagrams of the build pipeline and the browser runtime |


> The code in this repository addresses concrete friction points that arise during the development and maintenance of Fact Graph applications. 
> Our primary focus is increasing delivery capacity by making system behavior, dependencies, and logic easier to trace, understand, and validate.
> We do this with tools aimed at exposing rule logic in the context of the built application to make it easier for engineers and stakeholders to collaborate, test, and ship with confidence.
> The goal is to demonstrate "what it would take" to solve these problems, allowing us to learn what is practical and valuable before committing to long-term architectural standards.
> Rather than shipping production-grade code for a dedicated platform team to maintain, we deliberately prioritized experimentation and rapid prototyping over strict engineering maintainability. 
> We fully anticipate that this code is a starting point for functionality and architecture, not the end result, and expect that it will be superseded in the future.
> Do not deploy this repository directly to a production environment as-is. It lacks the necessary security, error-handling, and scalability guardrails.

![Diagram of the Taxpert suite, its workspaces, modes, tools and controls](docs/taxpert_layout.png)

## Quickstart

[QUICKSTART.md](docs/QUICKSTART.md) is the single setup document for this repository as well as the related 
form-builder 
applications around it. It covers how to run a Form Builder application with Taxpert included (in Docker or
natively), the commands that propogate a change in `form-builder` or in this repository out to other
application that use these libraries, and the failure modes you are most likely to hit.

## Where this sits

| Repository | What it is | How you consume it |
|---|---|---|
| [fact-graph](https://github.com/IRS-Public/fact-graph) | The rules engine. Declarative facts, derived and writable, with `Incomplete` propagation. Scala 3, cross-compiled so the same rules evaluate on the JVM during generation and in the browser at runtime. | `gov.irs::factgraph` |
| [form-builder](https://github.com/IRS-Public/form-builder) | The scaffold. Flow XML plus a Fact Dictionary become a multi-language static site. Ships the browser theme, the flow runtime and the Author Mode backend inside its jar. | `gov.irs::form-builder` |
| [form-builder-template](https://github.com/IRS-Public/form-builder-template) | Cookiecutter that emits a new Form Builder application. | `cookiecutter gh:IRS-Public/form-builder-template` |
| taxpert | The optional workspace UI and its companion services. | `taxpert`, as a `file:` dependency on a checkout, plus container images |
| [form-builder-examples](https://github.com/IRS-Public/form-builder-examples) | The reference applications: Credit Assistant (EITC), the Tax Withholding Estimator, and Benefits Enrollment. Demonstration code, kept out of this repository so nothing here depends on an application. | Clone it beside this one |


## Legal disclaimer: public repository access

> This repository contains draft and under-development source code. It is made available to the
> public solely for transparency, collaboration, and research purposes.
>
> **No endorsement or warranty.** IRS does not endorse, maintain, or guarantee the accuracy,
> completeness, or functionality of the code in this repository. The IRS assumes no responsibility
> or liability for any use of the code by external parties, including individuals, developers, or
> organizations. This includes, but is not limited to, any tax consequences, computation errors,
> data loss, or other outcomes resulting from the use or modification of this code.
>
> Use of the code in this repository is at your own risk. This repository is not intended for
> production use or public consumption as a finalized product.
>
> Artificial intelligence was used in generating portions of this codebase.

## Authorities

Legal foundations for this work include:

- The Source Code Harmonization And Reuse in Information Technology Act of 2024, Public Law 118-187
- OMB Memorandum M-16-21, "Federal Source Code Policy: Achieving Efficiency, Transparency, and
  Innovation through Reusable and Open Source Software," August 8, 2016
- Federal Acquisition Regulation (FAR) Part 27, Patents, Data, and Copyrights
- Digital Government Strategy: "Digital Government: Building a 21st Century Platform to Better
  Serve the American People," May 23, 2012
- Federal Information Technology Acquisition Reform Act (FITARA), December 2014 (National Defense
  Authorization Act for Fiscal Year 2015, Title VIII, Subtitle D)
- E-Government Act of 2002, Public Law 107-347
- Clinger-Cohen Act of 1996, Public Law 104-106
