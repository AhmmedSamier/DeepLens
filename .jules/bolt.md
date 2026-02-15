## 2025-02-12 - [SearchEngine] Optimized Endpoint Method Matching
**Learning:** `SearchEngine` was performing an O(N) regex match (`item.name.match(...)` or `query.match(...)`) inside the hot loop for every `ENDPOINT` item to extract HTTP methods. This was both inefficient and, in one case, logically broken because the query path was already stripped of the method.
**Action:** Lifted the method extraction to `RouteMatcher.prepare` (for queries) and `RouteMatcher.precompute` (for templates), storing the method in `PreparedPath.method` and `RoutePattern.method`. The hot loop now uses O(1) property access and string comparison, resulting in a ~23-30% performance improvement for endpoint searches. Always inspect regex usage inside hot loops!

## 2025-02-12 - [SearchEngine] Optimized Item Name Matching
**Learning:** The `SearchEngine` hot loop was performing expensive CamelHumps and Fuzzy matching on item names even when the name didn't contain all query characters. Although `Fuzzysort` is fast at rejecting mismatches, the cumulative overhead of `capitals.indexOf` and `Fuzzysort.single` calls was significant (~20% of search time).
**Action:** Implemented a pre-check using `itemNameBitflags` against `queryBitflags` to skip both CamelHumps and Fuzzy name matching if the name is guaranteed to miss. This optimization reduced search time by ~20% in benchmarks (26.5ms vs 33.5ms).
