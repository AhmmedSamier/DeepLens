## 2024-05-23 - Lazy Object Access with SoA
**Learning:** Pure Struct of Arrays (SoA) conversions (e.g. `item.type` -> `types[i]`) might not yield performance gains if the original object is still accessed in the hot loop, as V8 optimizes property access well. The real win comes from using SoA to *avoid* accessing the heavy object entirely until it passes the filter (lazy loading).
**Action:** When converting to SoA, ensure the hot loop relies *only* on the parallel arrays and delays accessing the original object until absolutely necessary.

## 2024-05-24 - Defer Eager Lookups in Hot Loops
**Learning:** Even simple array lookups (like `ID_TO_BOOST[types[i]]`) add up in tight loops with high iteration counts (100k+). Deferring them until strictly needed (after a match is confirmed) yielded a ~40% speedup in the fuzzy search hot path.
**Action:** Audit hot loops for eager calculations or lookups that can be made conditional.

## 2024-05-25 - Primitive Argument Passing for SoA
**Learning:** Even fast typed array accesses (e.g., `this.itemTypeIds[i]`) have overhead when repeated in tight loops (fuzzy matching). Passing the value as a primitive argument to helper methods yielded a significant speedup (~40%) by avoiding repeated property access and `this` lookups.
**Action:** When using SoA, fetch values once at the top of the loop and pass them down to helper functions.

## 2024-05-26 - Lazy Object Access in Burst Search
**Learning:** In `burstSearch`, checking `preparedNamesLow` (parallel array) *before* accessing `this.items[i]` (object) reduced the "no match" scan time by ~4% (4.13ms -> 3.97ms for 50k items). While skipping object access is faster, ensuring robustness (fallback for missing cache) adds slight overhead but maintains correctness.
**Action:** When iterating parallel arrays, use them as a fast path filter but ensure a fallback path exists if data synchronization is not guaranteed.
