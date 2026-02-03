  # AGENTS.md

## Build/Lint/Test Commands

### Language Server (language-server/)
```bash
cd language-server

# Build
bun run build

# Run all tests
bun test

# Run a single test file
bun test src/core/search-engine.test.ts

# Lint
bun run lint

# Format code
bun run format

# Run benchmarks
bun run benchmark
```

### VSCode Extension (vscode-extension/)
```bash
cd vscode-extension

# Full compile (includes language-server build)
bun run compile

# Watch mode for development
bun run watch

# Run tests
bun run test

# Lint
bun run lint

# Format code
bun run format

# Package extension (.vsix)
bun run vsix

# Development
# Press F5 in VS Code to launch Extension Development Host
# Use Shift+Shift to trigger DeepLens search
```

## Code Style Guidelines

### Import Style
- Use `import * as` for Node.js modules: `import * as fs from 'fs'`
- Use named imports for external packages: `import { SearchEngine } from './search-engine'`
- Imports are organized automatically by `prettier-plugin-organize-imports`
- Group imports: Node modules → external packages → local modules
- Use absolute paths for language-server imports from vscode-extension: `import { Config } from '../../language-server/src/core/config'`

### Formatting (Prettier)
- **Semicolons**: Required (`"semi": true`)
- **Quotes**: Single quotes (`"singleQuote": true`)
- **Trailing commas**: All places (`"trailingComma": "all"`)
- **Line width**: 120 characters (`"printWidth": 120`)
- **Indentation**: 4 spaces, no tabs (`"tabWidth": 4`, `"useTabs": false`)
- **End of line**: Auto-detect

### Naming Conventions
- **Classes**: PascalCase (`SearchEngine`, `RipgrepService`, `WorkspaceIndexer`)
- **Interfaces**: PascalCase, prefix `I` for service interfaces (`ISearchProvider`, `ActivityStorage`)
- **Enums**: PascalCase for type, snake_case for values (`SearchItemType.FILE`)
- **Functions/Methods**: camelCase (`search`, `getItems`, `removeItemsByFile`)
- **Variables/Properties**: camelCase (`filePath`, `lineNumber`, `cancellationToken`)
- **Constants**: UPPER_SNAKE_CASE (`ITEM_TYPE_BOOSTS`, `ID_TO_BOOST`, `SAVE_INTERVAL`)
- **Private members**: camelCase with `private` keyword, underscore prefix optional (`private cancellationToken`)
- **Files**: kebab-case for non-TypeScript files, PascalCase for test files (`activity-tracker.ts`, `ActivityTracker.test.ts`)

### TypeScript Style
- **Types**: Explicit type annotations for public APIs, inferred for implementation
- **Enums**: Use string enums (`SearchItemType.FILE = 'file'`) for better serialization
- **Interfaces**: Use for object shapes (`SearchableItem`, `SearchResult`)
- **Type aliases**: Use for union types or complex types
- **Optional properties**: Use `?` modifier (`line?: number`)
- **Null/undefined checks**: Use strict null checks enabled
- **Any types**: Avoid `any`; use `unknown` with type guards when needed
- **Type assertions**: Prefer type guards over assertions

### Error Handling
- **Custom errors**: Extend `Error` class for domain-specific errors
  ```typescript
  export class CancellationError extends Error {
      constructor(message: string = 'Operation cancelled') {
          super(message);
          this.name = 'CancellationError';
      }
  }
  ```
- **Try-catch**: Wrap I/O operations, external calls, and user input
- **Error propagation**: Use async/await with try-catch, avoid callback error patterns
- **Silent failures**: Only for optional operations (e.g., chmod, logging)
- **Logging**: Use logger service for errors, avoid console.error

### Testing Guidelines
- **Test framework**: Bun test for language-server, Mocha for vscode-extension
- **Test files**: Same directory as source, `.test.ts` suffix
- **Test structure**: Use `describe` for suites, `it`/`test` for individual tests
- **Assertions**: Use `expect` from bun/test or `assert` from Node
- **Setup/teardown**: Use `beforeEach`, `afterEach` hooks
- **Mocking**: Minimal mocking, prefer integration tests
- **Test data**: Create factory functions (`createTestItem`) for reusable test objects

### Code Organization
- **Core logic**: `language-server/src/core/` (search-engine, indexer, providers)
- **Server**: `language-server/src/server.ts` (LSP connection, request handlers)
- **Extension**: `vscode-extension/src/` (VS Code integration, UI)
- **Providers**: Separate classes for different result types (`SymbolProvider`, `FileProvider`)
- **Worker**: Indexing runs in separate worker thread (`indexer-worker.ts`)
- **Tests**: Co-located with source files

### ESLint Rules
- **Config**: Flat config format (`eslint.config.js`)
- **Parser**: `@typescript-eslint/parser`
- **Plugins**: `@typescript-eslint`, `sonarjs`
- **Enabled rules**:
  - TypeScript ESLint recommended
  - SonarJS recommended (except `os-command`, `no-os-command-from-path`)
  - `no-throw-literal`: warn (use `new Error()`)
  - `no-undef`: error

### Performance Considerations
- **Indexing**: Runs in worker threads, configurable concurrency
- **Search**: Parallel arrays (Struct of Arrays) for memory efficiency
- **Caching**: Use `Map` for prepared strings, deduplicate repeated searches
- **Workers**: Use `os.cpus().length - 1` workers for indexing
- **Debouncing**: Coalesce save operations, use timers for file watching
- **Memory**: Reuse objects where possible, avoid unnecessary allocations

### Git Conventions
- **Branches**: feature/, bugfix/, hotfix/
- **Commits**: Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`)
- **Workflow**: Feature branches → PR → main

### VS Code Specific
- **Extension API**: Use `vscode` namespace
- **Context**: Use `ExtensionContext` for state, path access
- **Commands**: Register with `vscode.commands.registerCommand`
- **Output**: Use logger service, avoid `console.log`
- **UI**: Use `QuickPick` for search interface, `StatusItem` for status
