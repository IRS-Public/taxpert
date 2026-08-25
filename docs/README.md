# Documentation

Project-level documentation for the Taxpert repository. These documents cover the platform as a
whole, including the example applications, which live in
[their own repository](https://github.com/IRS-Public/form-builder-examples) and are described here as
consumers of this code. Each component also has its own README with build commands and layout,
linked from the root [README.md](../README.md).

## Start here

| Order                                | Document                               | Read it when you want to know |
|--------------------------------------|----------------------------------------|---|
| 1                                    | [taxpert-form-builder-fact-graph.md](adr/taxpert-form-builder-fact-graph.md)       | Why this exists, what problems it solves, and why it is open source |
| 2                                    | [architecture.md](architecture.md)     | How the pieces fit together, with diagrams of the build pipeline and the browser runtime |
| 3                                    | [onboarding.md](onboarding.md)         | How to get everything running on your machine, every build flag, and the failure modes you are likely to hit |
| 4                                    | [release-status.md](release-status.md) | What is in this release, how mature each part is, and what is present in the tree without being finished |
| 5     | [deployment.md](deployment.md)         | The static path with no backend, the full container stack, and the tradeoffs between them |

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

