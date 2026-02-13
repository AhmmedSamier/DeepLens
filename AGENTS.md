# Agent Instructions for DeepLens

This document provides essential information for AI agents working on the DeepLens repository. DeepLens is a multi-component project consisting of a VS Code extension, a Language Server, and a Visual Studio extension.

## Project Overview

- **vscode-extension**: Main entry point for VS Code, handles UI, client-side logic, and VS Code API integration.
- **language-server**: Core search engine and workspace indexing using Tree-sitter and ripgrep. It runs as a separate process.
- **visual-studio-extension**: Visual Studio 2026 integration (C# codebase) that communicates with the same Language Server.

## Build & Development Commands

The project uses `bun` as the primary package manager and runtime.

### vscode-extension
```bash
cd vscode-extension
bun install
bun run compile        # Cleans, builds LS, then builds extension via esbuild
bun run watch          # Watch mode for development
```

### language-server
```bash
cd language-server
bun install
bun run build          # Builds the server and indexer worker into dist/
```

## Linting & Formatting

The project uses ESLint and Prettier with 4-space indentation.

```bash
# In either vscode-extension or language-server
bun run lint           # Run ESLint (using flat config in vscode-extension)
bun run format         # Format code with Prettier
```

## Testing Commands

### language-server (Unit Tests)
The language server uses `bun test` for fast unit testing.
```bash
cd language-server
bun run test           # Run all tests
bun test <file_path>   # Run a single test file (Recommended for focused work)
```

### vscode-extension (Integration Tests)
VS Code tests run in a headless Electron instance.
```bash
cd vscode-extension
bun run compile        # Ensure latest build is available
bun run test           # Run all integration tests
```

## Code Style Guidelines

### 1. Imports
- Use `import * as vscode from 'vscode'` for VS Code API.
- Use `import * as fs from 'fs'` for Node.js built-ins.
- Group imports: built-ins, external packages, then internal modules.
- The `prettier-plugin-organize-imports` is used to maintain order automatically.

### 2. Naming Conventions
- **Classes**: `PascalCase` (e.g., `SearchEngine`, `WorkspaceIndexer`, `DeepLensLspClient`).
- **Interfaces/Types**: `PascalCase` (e.g., `SearchOptions`, `SearchResult`).
- **Methods/Functions**: `camelCase` (e.g., `indexWorkspace`, `recordActivity`).
- **Variables/Properties**: `camelCase`.
- **Enums**: `PascalCase` for the enum name and `SCREAMING_SNAKE_CASE` or `PascalCase` for members.
- **Files**: `kebab-case.ts` for most files (e.g., `lsp-client.ts`, `search-provider.ts`).

### 3. Types
- Prefer explicit types for function parameters and return values.
- Avoid `any` at all costs; use `unknown` if the type is truly unknown and cast carefully.
- Define core interfaces in `language-server/src/core/types.ts`.

### 4. Formatting
- **Indentation**: 4 spaces (configured in `.prettierrc` and `.editorconfig`).
- **Line Length**: 120 characters (configured in `.prettierrc`).
- **Quotes**: Single quotes for strings, except when avoiding escapes.
- **Semicolons**: Always use semicolons.

### 5. Error Handling
- Wrap async operations in `try/catch` blocks, especially in the LSP handlers to prevent server crashes.
- Use the `logger` in `vscode-extension/src/services/logging-service.ts`.
- In the Language Server, use `fileLogger` (found in `server.ts`) for persistent debug logs in `.deeplens/debug.log`.

### 6. Async Patterns
- Prefer `async/await` over raw promises.
- Use `Promise.all` for independent operations to improve performance.
- Always handle potential rejections in background tasks.

## Project Structure Highlights

- `language-server/src/core/`: The heart of the indexing and search logic.
- `language-server/src/core/providers/`: Different search providers (File, Symbol, Recent).
- `language-server/src/core/tree-sitter-parser.ts`: Handles multi-language parsing using WASM Tree-sitter.
- `vscode-extension/src/lsp-client.ts`: Handles JSON-RPC communication with the language server.
- `vscode-extension/src/search-provider.ts`: Manages the QuickPick UI and result streaming.

## Core Logic & Workers

- **Workspace Indexer**: Uses `indexer-worker.ts` via Node.js `worker_threads` to parse files in parallel without blocking the main LSP thread.
- **Tree-sitter**: WASM-based parsers are loaded dynamically. New languages must be added to `tree-sitter-parser.ts` and `scripts/setup-parsers.ts`.
- **Ripgrep**: Used for high-performance text search via `@vscode/ripgrep`.

## Communication Protocol
The extension and server communicate via custom LSP requests:
- `deeplens/burstSearch`: High-speed streaming search.
- `deeplens/rebuildIndex`: Force a full re-index.
- `deeplens/progress`: Server-to-client notifications for indexing progress.
- `deeplens/indexStats`: Returns counts of files, symbols, and cache size.

## Verification Checklist
1. Run `bun run compile` in `vscode-extension` to verify both server and extension build correctly.
2. If changing the search engine, run `bun run test` in `language-server`.
3. Ensure no new `any` types are introduced.
4. Verify that `Shift-Shift` still opens the search dialog after UI changes.

## Current Feature Context: File Icons in Search Results (001-file-icons-search)
- **Goal**: Add VSCode-style file icons to search results.
- **Implementation**:
    - File type detection based on extensions and filename patterns.
    - Icons loaded lazily via `@vscode/codicons`.
- **Constraints**: Must match VSCode explorer visual style; no significant performance regression.
