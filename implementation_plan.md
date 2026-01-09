# DeepLens LSP Architecture & Migration Plan

## Overview
DeepLens is being refactored to use a Language Server Protocol (LSP) architecture. This allows a single, high-performance backend (written in TypeScript/Bun) to serve both VS Code and Visual Studio 2026.

## Architecture
- **LSP Server**: A standalone executable built with Bun. It contains the core logic (Search Engine, Indexer, Tree-Sitter).
- **VS Code Client**: A thin wrapper that spawns the LSP server and communicates via LSP.
- **Visual Studio Client**: A C# VSIX project targeting .NET 10/VS 2026, using a WPF-based UI.

## Progress
### Phase 1: LSP Server ✅
- Decoupled `WorkspaceIndexer` and `TreeSitterParser` from VS Code.
- Implemented `LspIndexerEnvironment`.
- Built standalone `deeplens-lsp.exe` using Bun.

### Phase 2: VS Code Migration (In Progress)
- Refactored `extension.ts` to use abstracted indexer (Foundation ready).
- Need to update it to use LSP instead of in-process engine.

### Phase 3: Visual Studio Extension (In Progress)
- Created C# project targeting .NET 10.
- Implemented `DeepLensLanguageClient` (LSP Client).
- Created modern WPF Search UI.
- Implemented navigation from search results to code.
