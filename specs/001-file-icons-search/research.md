# Research: File Icons in Search Results

**Date**: 2026-02-12
**Feature**: File Icons in Search Results
**Branch**: 001-file-icons-search

## Decision 1: Icon Rendering Strategy

**Decision:** Use `resourceUri` property on `QuickPickItem` (casting/extending type if necessary) combined with `iconPath: new vscode.ThemeIcon('file')` to trigger native file icon rendering.

**Rationale:**
- **Consistency:** Ensures 100% match with VS Code Explorer (same theme, same logic).
- **Maintenance:** Zero maintenance. No need to map extensions to icons manually.
- **Performance:** Native rendering is optimized by VS Code.
- **Accuracy:** Correctly handles complex file associations (e.g., specific filenames like `package.json`, dotfiles) that manual mapping often misses.

**Alternatives Considered:**
- **Manual Mapping (codicons):** Using `@vscode/codicons` mapped to extensions. *Rejected* because it's monochrome and doesn't match user themes.
- **External Library (`vscode-icons-js`):** Bundling a massive icon set. *Rejected* due to bundle size and potential mismatch with user's actual theme.

## Decision 2: Asynchronous Loading Implementation

**Decision:** Implement a two-pass rendering approach where necessary, but rely primarily on VS Code's native handling.

1. **Immediate:** Render result with `iconPath: new vscode.ThemeIcon('file')` (generic fallback) to ensure layout stability.
2. **Native Async:** By providing `resourceUri`, VS Code handles the async loading of the specific theme icon. We do not need to implement a custom async loader or `setTimeout` loop unless the native behavior fails (which research suggests it shouldn't).

**Rationale:**
- VS Code's internal rendering handles icon fetching off the UI thread.
- Providing `resourceUri` is non-blocking.

**Alternatives Considered:**
- **Placeholder + Swap:** Explicitly setting a placeholder, then `setTimeout` to update `iconPath`. *Rejected* as unnecessary if native `resourceUri` works.

## Decision 3: Type Safety

**Decision:** Extend `vscode.QuickPickItem` in our code to include `resourceUri`.

```typescript
interface ExtendedQuickPickItem extends vscode.QuickPickItem {
    resourceUri?: vscode.Uri;
}
```

**Rationale:**
- The property exists in the underlying implementation (VS Code API) but might be missing from some version definitions or requires explicit usage.
- Ensures TypeScript compiles without `any` casts.

## Decision 4: Fallback Behavior

**Decision:** Always provide `iconPath: new vscode.ThemeIcon('file')` as the base. If `resourceUri` matches a specific file type, VS Code overlays/replaces it. If not, the generic icon remains.

**Rationale:**
- Meets spec requirement FR-007 (fallback).
- Prevents layout shift (icon gap).
