# Contracts

**Feature**: File Icons in Search Results
**Status**: Stable

## API Changes

This feature involves **UI-only changes** within the `vscode-extension` component. 

- **No new LSP methods** are introduced.
- **No changes to the existing `SearchResult` interface** in `language-server/src/core/types.ts`.
- The Extension client transforms existing `filePath` data into `resourceUri` locally.

Therefore, no new JSON-RPC schemas or GraphQL contracts are required.
