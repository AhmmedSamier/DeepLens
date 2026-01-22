# DeepLens Optimization Plan

## Primary Objective: Memory Optimization
Target: Reduce memory footprint for large repositories (~1M items) while maintaining or improving search latency.

## Completed Tasks

### Task 1: Refactor `SearchEngine` Internal Storage (Done)
The `SearchEngine` now uses a "Struct of Arrays" (Flyweight) pattern.
- Removed `items: SearchableItem[]` and `itemsMap`.
- Implemented parallel arrays: `ids`, `names`, `itemTypes`, `itemFileIds`, `itemLines`, etc.
- Deduplicated file paths using `uniqueFiles` and `itemFileIds`.
- Optimized `setItems`, `addItems`, `removeItemsByFile`, and search methods to use this new structure.
- Objects are only reconstructed on-demand during search results generation.

### Task 2: Optimize Scope Storage (Done)
- `scopedIndices` now stores `number[]` (indices) instead of object references.
- `SearchScope.EVERYTHING` is handled implicitly (no storage).

### Task 3: Test Coverage (Done)
- Added unit tests for `MinHeap`.
- Verified `SearchEngine` refactor with existing tests.

## Future Tasks

### Task 4: WorkspaceIndexer Optimizations
1.  **Direct Component Emission**: Currently `WorkspaceIndexer` still creates `SearchableItem` objects which are then decomposed by `SearchEngine`. To further optimize (reduce GC pressure during indexing), `WorkspaceIndexer` could emit "chunks" of component arrays directly (e.g., `names: string[], types: Uint8Array[]`).
2.  **Optimize `excludePatterns`**: Pre-compile minimatch patterns (Already done in `WorkspaceIndexer`).

### Task 5: Search Loop Optimization
1.  **Loop Unrolling**: In `fuzzySearch`, standard `for` loops are faster than `forEach` or `map`. (Already using `for` loops).
2.  **SIMD**: Explore using WASM or native modules for the core scoring loop if JS performance hits a ceiling.

### Task 6: Visual Studio Extension
- Review `DeepLensVisualStudio` for similar optimizations if it maintains its own index (it likely uses the LSP, so this benefit propagates).
