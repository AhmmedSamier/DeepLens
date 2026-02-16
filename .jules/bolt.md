## 2025-02-12 - [SearchEngine] Optimized Endpoint Method Matching
**Learning:** `SearchEngine` was performing an O(N) regex match (`item.name.match(...)` or `query.match(...)`) inside the hot loop for every `ENDPOINT` item to extract HTTP methods. This was both inefficient and, in one case, logically broken because the query path was already stripped of the method.
**Action:** Lifted the method extraction to `RouteMatcher.prepare` (for queries) and `RouteMatcher.precompute` (for templates), storing the method in `PreparedPath.method` and `RoutePattern.method`. The hot loop now uses O(1) property access and string comparison, resulting in a ~23-30% performance improvement for endpoint searches. Always inspect regex usage inside hot loops!

## 2025-02-12 - [SearchEngine] Exponential Growth for Hot Arrays
**Learning:** `SearchEngine.addItems` was resizing TypedArrays to the exact required size for every batch of items added. Since `WorkspaceIndexer` adds items in batches of 50, this caused O(N^2) complexity due to repeated allocations and copying.
**Action:** Implemented an exponential growth strategy (1.5x capacity) for `itemTypeIds`, `itemBitflags`, and `itemNameBitflags`. Benchmarking showed a **~32% improvement** (806ms -> 548ms) when indexing 60k items in batches of 50. Always consider growth strategy when resizing buffers in a loop!
