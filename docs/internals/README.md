# Documentation

## Internals

Written for someone about to change the code, and referenced from the source files they describe.
Each one holds the reasoning that would otherwise sit as long comment blocks in the modules.

| Document | Covers |
|---|---|
| [workspace-configuration.md](workspace-configuration.md) | The three-layer config, the schema gate, and the four host ports the workspace reaches through |
| [global-nav.md](global-nav.md) | `<taxpert-global-nav>`: attributes, events, the taxonomy, the tool strip, and the stylesheet's tokens |
| [audit-panel.md](audit-panel.md) | The page-level mount, the three nav dialogs, display options, the screens toolbar, the path cursor, feature flags |
| [tool-panels.md](tool-panels.md) | The dock, layout state, dragging, and the four tool bodies |
| [fact-explorer-internals.md](fact-explorer-internals.md) | The Form Graph Model, the narrowing chain, the engine, the scenario overlay, layout, the live bridge |
| [assistant-service.md](assistant-service.md) | The two agent loops, their tools, the RAG index, and the environment |
| [ai-integration.md](ai-integration.md) | Where the LLM surfaces sit today, how to turn them on, their limits, and proposed expansion |
| [style-guides/](style-guides/README.md) | Conventions for Thymeleaf templates, CSS, and browser JavaScript |
