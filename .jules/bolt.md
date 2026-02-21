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
**Action:** Removed `preparedNamesLow` and `preparedLowCache`. Updated `burstSearch` to access `_targetLower` directly from the `Fuzzysort.Prepared` object (via casting). This reduces memory usage by eliminating duplicate string storage and pointer arrays, and saves CPU by avoiding a second `toLowerCase()` call per item.
## 2026-02-19 - [SearchEngine] Search-Time Optimizations (US1/US2)
**Learning:** Even with parallel arrays, scanning 100k+ items with `Fuzzysort.single` in a tight loop hit performance limits (especially CamelHumps matching which was 30ms+).
**Action:**
1.  **Bitflag Audit:** Confirmed bitflag screening fires first, which is critical.
2.  **Character-Distance Guard:** Added `Math.abs(queryLen - targetLen) > queryLen` guard. This skips ~70% of mismatched candidates before they hit the expensive fuzzy scorer.
3.  **Deferred Activity Boosting:** Removed activity score lookup (O(1) but frequent) from the hot loop. Highly-scored items are now boosted post-heap assembly.
4.  **CamelHumps Logic Fix:** Fixed an inefficiency where CamelHumps was under-prioritizing exact prefix matches in capitals.
**Result:** **~80% reduction** in CamelHumps search time (32.9ms -> 5.5ms) and **~30-50%** improvement in large-result-set fuzzy searches.

## 2026-02-19 - [SearchEngine] Deferred StartsWith Check in Hot Loop
**Learning:** The `shouldProcessItem` hot loop was executing `startsWith` (string comparison) for every item that passed the bitflag check, even if the item was already going to be processed because its length was close enough to the query.
**Action:** Reordered the logic to only check `startsWith` (as a rescue mechanism) *after* the length difference check fails. This avoids the expensive string operation for ~95% of valid candidates.
**Result:** **~11.4% improvement** (68ms -> 60ms) in search scenarios with many bitflag-matching candidates. Always optimize the order of checks in hot loops: cheapest first!
