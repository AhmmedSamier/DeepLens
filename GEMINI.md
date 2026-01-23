# DeepLens

DeepLens is a high-performance "Search Everywhere" tool for VS Code and Visual Studio, powered by a standalone language server. It provides unified navigation across types, symbols, files, and text with fuzzy matching, CamelHumps support, and activity-based ranking.

## Project Structure

The repository is a monorepo containing:

- **`language-server/`**: The core logic implemented as a Language Server Protocol (LSP) server. It uses `tree-sitter` for parsing and provides indexing and search capabilities.
- **`vscode-extension/`**: The Visual Studio Code client that consumes the language server and integrates with VS Code's UI (QuickPick, CodeLens).
- **`visual-studio-extension/`**: The Visual Studio (Classic) extension (C#) integration.

## Technologies

- **Runtime/Package Manager:** [Bun](https://bun.sh) (for TS/JS parts)
- **Languages:** TypeScript (Core & VS Code), C# (Visual Studio)
- **Parsing:** `web-tree-sitter` and various `tree-sitter-*` grammars.
- **Protocol:** VS Code Language Server Protocol.
- **Testing:** `bun test` (Server), `mocha` + `@vscode/test-electron` (VS Code).

## Getting Started

### Prerequisites

- **Bun**: This project uses `bun` for package management and running scripts.
- **Node.js**: Required for some VS Code extension build tools.

### Setup

1.  **Install dependencies:**

    ```bash
    # In language-server directory
    cd language-server
    bun install

    # In vscode-extension directory
    cd ../vscode-extension
    bun install
    ```

## Development Workflow

### Building

The VS Code extension depends on the language server. The `compile` script in the VS Code extension handles building both.

```bash
cd vscode-extension
bun run compile
```

This command will:
1.  Clean previous builds.
2.  Bundle the VS Code extension code.
3.  Build the Language Server (`dist/server.js`, `dist/indexer-worker.js`).
4.  Copy necessary artifacts (parsers, binaries) to the extension's output directory.

### Running Tests

**Language Server:**
```bash
cd language-server
bun run test
```

**VS Code Extension:**
```bash
cd vscode-extension
bun run test
```
*Note: VS Code tests run in a headless VS Code instance.*

### Benchmarks

To run performance benchmarks for the language server:

```bash
cd language-server
bun run benchmark
```
Or use the root script:
```bash
./run_benchmarks.sh
```

### Packaging

To create a `.vsix` for VS Code:

```bash
cd vscode-extension
bun run vsix
```

## Conventions

-   **Code Style:** Adhere to `eslint` and `prettier` configurations.
    -   Lint: `bun run lint`
    -   Format: `bun run format`
-   **Commits:** Follow standard git commit conventions.
-   **CI:** Check `.github/workflows/ci.yml` for the continuous integration pipeline details.

# Git & Commit Standards

## Conventional Commits
When generating or suggesting commit messages, you MUST follow the Conventional Commits 1.0.0 specification.

### Structure
`<type>[optional scope]: <description>`

### Allowed Types
* **feat**: A new feature for the application.
* **fix**: A bug fix.
* **docs**: Documentation only changes.
* **style**: Changes that do not affect the meaning of the code (white-space, formatting, etc).
* **refactor**: A code change that neither fixes a bug nor adds a feature.
* **perf**: A code change that improves performance (e.g., MySQL query optimizations).
* **test**: Adding missing tests or correcting existing tests.
* **chore**: Changes to the build process or auxiliary tools and libraries (e.g., K8s manifests, GitLab pipelines).

### Scopes for this Project
* **api**: For .NET / Entity Framework changes.
* **ui**: For Angular / Tailwind / CSS changes.
* **db**: For MySQL migrations or indexing changes.
* **ext**: For VS Code/Zed extension logic.
* **infra**: For Kubernetes, Docker, or CI/CD changes.

### Rules
1. Use the imperative, present tense: "change" not "changed" nor "changes".
2. Don't capitalize the first letter of the description.
3. No dot (.) at the end.