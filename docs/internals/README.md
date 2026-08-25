# Documentation

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
| [ai-integration.md](internals/ai-integration.md) | Where the LLM surfaces sit today, how to turn them on, their limits, and proposed expansion |
| [style-guides/](internals/style-guides/README.md) | Conventions for Thymeleaf templates, CSS, and browser JavaScript |
