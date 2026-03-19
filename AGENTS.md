# Agent Instructions for DeepLens

This document provides essential information for AI agents working on the DeepLens repository. DeepLens is a multi-component project consisting of a VS Code extension, a Language Server, and a Visual Studio extension.

## Project Overview

- **vscode-extension**: Main entry point for VS Code, handles UI, commands, and client-side integration (including Call Chain Visualizer and CodeVision).
- **language-server**: Core search engine ("Bolt") and workspace indexing using Tree-sitter and ripgrep. It runs as a separate process.
- **visual-studio-extension**: Visual Studio 2026 integration (C# codebase) that communicates with the same Language Server.

## ⚡ Bolt Search Engine

The "Bolt" engine is the heart of DeepLens, optimized for high-performance indexing and search:

- **Bitflag Pre-checking**: Uses fast bitmask operations to filter candidates before expensive scoring.
- **Path Cache**: 1-item cache for path normalization to reduce string allocations in hot loops.
- **Fast-Path Matching**: Optimized for exact and prefix matches to return results instantly.
- **Minimized Object Allocations**: Uses `fuzzysort` efficiently and avoids object creation in scoring loops.

## 🧬 Call Chain Visualizer

The Call Chain Visualizer is a client-side feature in the VS Code extension that helps understand complex execution flows:

- **Standard Hierarchy**: Uses `vscode.prepareCallHierarchy` and `vscode.provideIncomingCalls`.
- **Reference Fallback**: If call hierarchy is unavailable, it falls back to a reference-based traversal for languages like C#.
- **Interactive Webview**: Renders an interactive tree view with navigation links to source code.

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
bun run format         # Format code with oxfmt
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
- The `oxfmt` formatter automatically organizes imports.

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

- **Indentation**: 4 spaces (configured in `.oxfmtrc` and `.editorconfig`).
- **Line Length**: 120 characters (configured in `.oxfmtrc`).
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
- `vscode-extension/src/search-provider.ts`: Manages the QuickPick UI, result streaming, and "Pro Tips" empty state.
- `vscode-extension/src/file-icon-provider.ts`: Detects file types and assigns VSCode-style icons for search results.

## Core Logic & Workers

- **Workspace Indexer**: Uses `indexer-worker.ts` via Node.js `worker_threads` to parse files in parallel without blocking the main LSP thread.
- **Fast LRU Eviction**: Indexer uses an optimized LRU cache with fast eviction to keep memory usage stable in massive solutions.
- **Incremental Events**: Consistently handles incremental file events (`onDidChange`, `onDidCreate`, `onDidDelete`) to keep the search index in sync with disk.
- **Tree-sitter**: WASM-based parsers are loaded dynamically. New languages must be added to `tree-sitter-parser.ts` and `scripts/setup-parsers.ts`.
- **Ripgrep**: Used for high-performance text search via `@vscode/ripgrep`.

## Communication Protocol

The extension and server communicate via custom JSON-RPC requests over IPC:

### Core Search Requests

- `deeplens/search`: Standard fuzzy search (returns all at once).
- `deeplens/burstSearch`: High-speed streaming search (returns initial batch and streams the rest).
- `deeplens/resolveItems`: Get full details for a list of search item IDs.

### History & Activity

- `deeplens/getRecentItems`: Retrieve recently accessed items.
- `deeplens/recordActivity`: Notify the server that an item was accessed.
- `deeplens/clearHistory`: Wipe all search and access history.
- `deeplens/removeHistoryItem`: Remove a specific item from history.
- `deeplens/setActiveFiles`: Update the list of files currently open in the editor (boosts relevance).

### Index Management

- `deeplens/rebuildIndex`: Trigger a full workspace re-index.
- `deeplens/clearCache`: Clear the persistent index cache on disk.
- `deeplens/indexStats`: Returns counts of files, symbols, and cache size.

### Notifications

- `deeplens/progress`: Server-to-client notifications for indexing status (start, report, end).
- `deeplens/ripgrepUnavailable`: Notification when ripgrep binary is not found.

## Verification Checklist

1. Run `bun run compile` in `vscode-extension` to verify both server and extension build correctly.
2. If changing the search engine, run `bun run test` in `language-server`.
3. Ensure no new `any` types are introduced.
4. Verify that `Shift-Shift` still opens the search dialog after UI changes.

## Git Commit Guidelines

- All commits must follow [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `style:` for code style changes (formatting, etc.)
  - `refactor:` for code refactoring
  - `test:` for adding or updating tests
  - `chore:` for maintenance tasks

## Current Feature Context: File Icons in Search Results (001-file-icons-search)

- **Goal**: Add VSCode-style file icons to search results.
- **Implementation**:
    - File type detection based on extensions and filename patterns.
    - Icons loaded lazily via `@vscode/codicons`.
- **Constraints**: Must match VSCode explorer visual style; no significant performance regression.
