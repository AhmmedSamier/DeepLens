# DeepLens Web Support Implementation Guide

This guide details the necessary steps to enable **DeepLens** to run in **Visual Studio Code for the Web** (vscode.dev, github.dev).

## Overview

The current implementation of DeepLens relies heavily on Node.js APIs (`fs`, `child_process`, `os`, `path`) and the Node.js version of the Language Server Protocol. To support the web, we must:

1.  **Split the Entry Points**: Create separate entry points for Node.js (Desktop) and Browser (Web).
2.  **Abstract System Access**: Replace direct `fs` and `child_process` usage with interfaces that can be swapped or disabled in the browser.
3.  **Run in a Web Worker**: The Language Server must run inside a Web Worker, communicating via `postMessage` instead of IPC.
4.  **Delegate to Client**: File system operations like scanning files (`glob`) must be delegated to the VS Code Client (which uses `vscode.workspace.findFiles`), as the browser server cannot directly access the file system.

## 1. Extension Manifest (`package.json`)

You must define a `browser` entry point in `vscode-extension/package.json`.

```json
{
  "main": "./dist/extension.js",
  "browser": "./dist/extension.browser.js",
  "dependencies": {
    "vscode-languageclient": "^9.0.1" // Supports both /node and /browser
  }
}
```

## 2. Dependency Updates

### `language-server/package.json`
*   **Remove/Dev-Only**: `@vscode/ripgrep` (Node only, binary).
*   **Alternatives**:
    *   `glob`: Replace with `micromatch` or rely on client-side `findFiles`.
    *   `path`: Polyfill with `path-browserify` for the browser bundle.

### `vscode-extension/package.json`
Ensure `vscode-languageclient` is used generically where possible, but imports will need to change (see below).

## 3. Architecture: Abstraction Layers

### File System Abstraction
Create an interface in `language-server/src/core/fs-provider.ts`:

```typescript
export interface IFileSystemProvider {
    readFile(path: string): Promise<string>;
    readDirectory(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean }>;
    glob(pattern: string): Promise<string[]>; // Browser: calls client; Node: uses glob
}
```

*   **Node Implementation**: Uses `fs.promises`, `glob`.
*   **Browser Implementation**: Uses `connection.sendRequest('deeplens/readFile', ...)` to ask the client to read files via `vscode.workspace.fs`.

### Environment Abstraction
Refactor `WorkspaceIndexer` to stop importing `cp` (child_process) and `fs` directly. Pass these capabilities via the constructor or the `IndexerEnvironment`.

## 4. Language Server Changes

### New Entry Point: `language-server/src/browser-server.ts`

The browser server uses `createConnection` from `vscode-languageserver/browser`.

```typescript
import { createConnection, BrowserMessageReader, BrowserMessageWriter } from 'vscode-languageserver/browser';

const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);
const connection = createConnection(messageReader, messageWriter);

// ... Reuse core logic (SearchEngine, etc.) ...
// Initialize logic must inject the BrowserFileSystemProvider.
```

### Tree-sitter WASM
`web-tree-sitter` works in the browser but requires loading the `.wasm` file.
*   **Node**: `fs.readFileSync` the wasm.
*   **Browser**: `fetch` the wasm relative to the extension URI. You will need to pass the extension's base URI from the client during initialization.

## 5. VS Code Extension Changes

### New Entry Point: `vscode-extension/src/extension.browser.ts`

This file handles activation in the web.

```typescript
import { LanguageClient } from 'vscode-languageclient/browser';

export function activate(context: vscode.ExtensionContext) {
    // ...
    const serverMain = vscode.Uri.joinPath(context.extensionUri, 'dist/server.browser.js');
    const worker = new Worker(serverMain.toString());

    const client = new LanguageClient('deeplens', 'DeepLens', {
        // ... options
    }, worker);

    // Register file system providers for the server
    client.onRequest('deeplens/readFile', async (uri) => {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
        return new TextDecoder().decode(data);
    });
}
```

## 6. Build Configuration (`esbuild.js`)

You need a separate build config for the web version.

```javascript
// esbuild.browser.js
await esbuild.build({
    entryPoints: ['src/extension.browser.ts'],
    outfile: 'dist/extension.browser.js',
    format: 'cjs',
    platform: 'browser', // <--- Important
    external: ['vscode'],
    plugins: [
        polyfillNode({
            // Polyfill 'path' -> 'path-browserify'
            // Stub 'fs', 'child_process' -> empty objects
        })
    ]
});
```

## 7. Feature Flags / Trade-offs

Some features **must be disabled** or significantly altered for the web:

1.  **Git Integration**: `git ls-files` and `git check-ignore` rely on `child_process`.
    *   *Resolution*: Disable git-based indexing in the browser. Rely purely on `vscode.workspace.findFiles` (which respects `.gitignore` automatically in VS Code).
2.  **Worker Threads (`worker_threads`)**:
    *   *Resolution*: The `WorkspaceIndexer` currently uses Node worker threads for parallelism. In the browser, you must either:
        *   Run indexing on the main LSP worker thread (simpler, but might block).
        *   Implement a `WorkerProvider` that spawns true Web Workers (`new Worker('...')`). This requires a separate build step for the `indexer-worker.js` to ensure it has no Node dependencies.
3.  **Ripgrep**:
    *   *Resolution*: Text search in DeepLens Node uses `ripgrep` binary or stream scanning. In Browser, you must rely on VS Code's `vscode.workspace.findTextInFiles` (via a request to the client) or scan open documents only.

## 8. Implementation Checklist

- [ ] Create `extension.browser.ts` (Client entry)
- [ ] Create `server.browser.ts` (Server entry)
- [ ] Create `IFileSystemProvider` and refactor `SearchEngine`/`Indexer` to use it.
- [ ] Refactor `WorkspaceIndexer` to make Git and Node Workers optional.
- [ ] Update `esbuild` scripts to bundle the browser versions with polyfills.
- [ ] Add `browser` field to `package.json`.
- [ ] Verify `web-tree-sitter` WASM loading via `fetch` in the browser environment.
