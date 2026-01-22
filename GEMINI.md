# DeepLens Project Context

## Project Overview

**DeepLens** is a high-performance "Search Everywhere" navigation tool designed for both **VS Code** and **Visual Studio 2026**. It provides unified search capabilities for types, symbols, files, text, and API endpoints, powered by a standalone, highly optimized search engine.

### Key Features
*   **Search Everywhere**: Unified dialog for finding classes, methods, files, and text.
*   **Performance**: Built with a focus on speed (Tree-sitter parsing, parallel text search via Ripgrep, custom caching).
*   **Rider-style CodeLens**: Displays reference and implementation counts directly in the editor.
*   **LSP-Based**: The core search logic is implemented as a Language Server, allowing it to be shared between different IDEs (VS Code and Visual Studio).

## Architecture

The project is structured as a monorepo with three main components:

### 1. Language Server (`language-server/`)
The brain of DeepLens. It handles indexing, parsing, and search logic.
*   **Tech Stack**: TypeScript, Bun, Tree-sitter, Fuzzysort, Ripgrep, `vscode-languageserver`.
*   **Responsibilities**:
    *   Parsing code using Tree-sitter.
    *   Indexing symbols and files.
    *   Executing fuzzy searches.
    *   Managing search cache and persistence.

### 2. VS Code Extension (`vscode-extension/`)
The client for Visual Studio Code.
*   **Tech Stack**: TypeScript, VS Code API, `vscode-languageclient`.
*   **Responsibilities**:
    *   Starting the Language Server.
    *   Providing the UI for search (QuickPick, InputBox).
    *   Rendering CodeLenses.
    *   Handling user configuration.

### 3. Visual Studio Extension (`visual-studio-extension/`)
The client for Visual Studio 2022/2026.
*   **Tech Stack**: C#, .NET, Visual Studio SDK.
*   **Responsibilities**:
    *   Integration with Visual Studio's Tool Windows and Command system.
    *   Interfacing with the Language Server (via LSP or direct process communication).

## Development & Build

### Prerequisites
*   **Node.js** & **Bun** (Bun is the primary runtime for scripts).
*   **Visual Studio 2022+** (for C# extension).

### 1. Language Server (`language-server/`)
Run commands from the `language-server` directory:
*   **Build**: `bun run build` (Compiles TS to JS, sets up parsers).
*   **Test**: `bun test` (Runs unit tests).
*   **Benchmark**: `bun run benchmark` (Performance tests).
*   **Lint**: `bun run lint`.

### 2. VS Code Extension (`vscode-extension/`)
Run commands from the `vscode-extension` directory:
*   **Install Dependencies**: `bun install`.
*   **Build (Dev)**: `bun run compile` (Uses esbuild).
*   **Watch**: `bun run watch`.
*   **Package**: `bun run vsix` (Creates `.vsix` installer).
*   **Test**: `bun run test`.

### 3. Visual Studio Extension (`visual-studio-extension/`)
*   Open `DeepLensVisualStudio.slnx` in Visual Studio.
*   Build the solution to generate the VSIX.

## Key Conventions

*   **Package Manager**: `bun` is used for script execution and package management in JS/TS folders.
*   **Formatting**: Prettier is used (`.prettierrc`).
*   **Linting**: ESLint is used (`eslint.config.js`).
*   **Testing**:
    *   `bun test` for fast unit tests in the language server.
    *   `mocha` for integration tests in the VS Code extension.

## Current Focus (from `tasks.md`)

*   **Memory Optimization**: Refactoring the `SearchEngine` to reduce memory footprint.
    *   Moving from Array of Objects (`PreparedItem[]`) to Structure of Arrays (Parallel arrays).
    *   Optimizing scope storage.
    *   Reducing object creation during indexing.
