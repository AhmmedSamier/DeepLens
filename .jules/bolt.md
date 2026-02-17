## 2025-02-12 - [SearchEngine] Optimized Endpoint Method Matching
**Learning:** `SearchEngine` was performing an O(N) regex match (`item.name.match(...)` or `query.match(...)`) inside the hot loop for every `ENDPOINT` item to extract HTTP methods. This was both inefficient and, in one case, logically broken because the query path was already stripped of the method.
**Action:** Lifted the method extraction to `RouteMatcher.prepare` (for queries) and `RouteMatcher.precompute` (for templates), storing the method in `PreparedPath.method` and `RoutePattern.method`. The hot loop now uses O(1) property access and string comparison, resulting in a ~23-30% performance improvement for endpoint searches. Always inspect regex usage inside hot loops!

## 2025-02-12 - [SearchEngine] Exponential Growth for Hot Arrays
**Learning:** `SearchEngine.addItems` was resizing TypedArrays to the exact required size for every batch of items added. Since `WorkspaceIndexer` adds items in batches of 50, this caused O(N^2) complexity due to repeated allocations and copying.
**Action:** Implemented an exponential growth strategy (1.5x capacity) for `itemTypeIds`, `itemBitflags`, and `itemNameBitflags`. Benchmarking showed a **~32% improvement** (806ms -> 548ms) when indexing 60k items in batches of 50. Always consider growth strategy when resizing buffers in a loop!

## 2025-02-12 - [SearchEngine] O(1) ASCII Bitflags Lookup
**Learning:** `SearchEngine.calculateBitflags` employed a loop with multiple conditional branches (`if/else if`) to map characters to bit positions. Since this runs for every character of every item during indexing, the branch mispredictions added up.
**Action:** Replaced the conditional logic with a precomputed static `Uint32Array` lookup table (`CHAR_TO_BITFLAG`). Benchmarking demonstrated a **~1.27x speedup** for this specific function. Small O(1) lookups often beat branching logic in tight loops.
## 2025-02-12 - [SearchEngine] Removed Redundant Lowercased Strings
**Learning:** `SearchEngine` was maintaining a parallel `preparedNamesLow` array and a `preparedLowCache` Map to store lowercased item names for prefix matching. However, the `Fuzzysort.Prepared` objects (stored in `preparedNames`) already contain the lowercased string internally as `_targetLower`.
**Action:** Removed `preparedNamesLow` and `preparedLowCache`. Updated `burstSearch` to access `_targetLower` directly from the `Fuzzysort.Prepared` object (via casting). This reduces memory usage by eliminating duplicate string storage and pointer arrays, and saves CPU by avoiding a second `toLowerCase()` call per item. Always check if a library already computes/stores the data you need!
