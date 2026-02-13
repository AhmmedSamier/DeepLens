# Implementation Plan: File Icons in Search Results

**Branch**: `001-file-icons-search` | **Date**: 2026-02-12 | **Spec**: [Spec Link](./spec.md)
**Input**: Feature specification from `/specs/001-file-icons-search/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature enhances the search result UI in VS Code by adding native file icons to search results. The technical approach involves extending the `SearchResult` handling in the extension to calculate `resourceUri` for each file result and utilizing VS Code's `ThemeIcon.File` capability in `QuickPickItem`. This ensures 100% visual consistency with the VS Code Explorer and maintains performance by leveraging native rendering.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9.3, Node.js 25.0.3  
**Primary Dependencies**: vscode (^1.85.0), vscode-languageclient (^9.0.1), @vscode/codicons (implicit via ThemeIcon)  
**Storage**: N/A (In-memory search results)  
**Testing**: Bun test (Language Server), Mocha (Extension Integration)  
**Target Platform**: VS Code Desktop (Electron)  
**Project Type**: VS Code Extension  
**Performance Goals**: <10% degradation in search result rendering time. Asynchronous icon loading.  
**Constraints**: Must use VS Code native API for consistency.  
**Scale/Scope**: Feature enhancement within existing extension.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]
- **Library-First**: N/A (Feature integration)
- **CLI Interface**: N/A (UI Feature)
- **Test-First**: Mandatory (Spec P1/P2/P3 have independent tests)
- **Integration Testing**: Required for VS Code API interaction
- **Simplicity**: Native API usage prioritized (Option A in spec)

## Project Structure

### Documentation (this feature)

```text
specs/001-file-icons-search/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
vscode-extension/
├── src/
│   ├── search-provider.ts       # Main search UI logic (QuickPick)
│   ├── lsp-client.ts            # Communication with LS
│   └── test/                    # Integration tests
language-server/
├── src/
│   ├── core/
│   │   ├── types.ts             # Search result types
│   │   └── search-engine.ts     # Search logic
│   └── server.ts
```

**Structure Decision**: Enhance existing `vscode-extension` and `language-server` components. No new packages.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | | |
