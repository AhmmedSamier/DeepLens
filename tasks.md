# DeepLens Optimization Plan

## Primary Objective: Memory Optimization
Target: Reduce memory footprint for large repositories (~1M items) while maintaining or improving search latency.

## Task 1: Refactor `SearchEngine` Internal Storage (High Priority)
The current implementation wraps every `SearchableItem` in a `PreparedItem` object and potentially duplicates these in scope arrays.

**Current Structure:**
```typescript
interface PreparedItem {
    item: SearchableItem;
    preparedName: Fuzzysort.Prepared;
    preparedFullName: Fuzzysort.Prepared | null;
    preparedPath: Fuzzysort.Prepared | null;
}
private preparedItems: PreparedItem[];
```

**Proposed Refactor (Struct of Arrays / Parallel Arrays):**
Flatten the storage to reduce object header overhead and pointer chasing.
```typescript
private items: SearchableItem[];
private preparedNames: (Fuzzysort.Prepared | null)[];
private preparedFullNames: (Fuzzysort.Prepared | null)[];
private preparedPaths: (Fuzzysort.Prepared | null)[];
```

**Actions:**
1.  Remove `PreparedItem` interface.
2.  Change `SearchEngine` properties to use parallel arrays.
3.  Update `addItems` to populate all arrays synchronously.
4.  Update `removeItemsByFile` to splice/filter all arrays at the exact same indices.
5.  Refactor `rebuildHotArrays`.
6.  Remove `SearchScope.EVERYTHING` from `scopedItems` map (it is redundant with the main arrays).
7.  Update `search` and `fuzzySearch` logic to iterate via index `i` from `0` to `items.length` and access properties from parallel arrays.

## Task 2: Optimize Scope Storage (High Priority)
Currently, `scopedItems` is a `Map<SearchScope, PreparedItem[]>`.
For `SearchScope.EVERYTHING`, this is a full duplicate of `preparedItems` (referenced).
For other scopes, it's a filtered list of references.

**Actions:**
1.  Remove `SearchScope.EVERYTHING` from the map.
2.  Use the main parallel arrays when scope is `EVERYTHING`.
3.  (Optional) For specific scopes, consider storing `number[]` (indices) instead of object references if memory is still tight, though the current "array of references" is acceptable if `PreparedItem` wrapper is gone.

## Task 3: WorkspaceIndexer Optimizations (Secondary)
1.  **Flyweight SearchableItem**: The indexer creates full objects for every symbol.
2.  **Defer Object Creation**: Only create full `SearchableItem` objects when needed (e.g., keeping data in flat buffers until search time).
3.  **Optimize `excludePatterns`**: Pre-compile minimatch patterns.

## Task 4: Search Loop Optimization
1.  **Loop Unrolling**: In `fuzzySearch`, standard `for` loops are faster than `forEach` or `map`.
2.  **Access Pattern**: Accessing `this.preparedNames[i]` is fast.
