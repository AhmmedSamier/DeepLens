## 2024-05-23 - Lazy Object Access with SoA
**Learning:** Pure Struct of Arrays (SoA) conversions (e.g. `item.type` -> `types[i]`) might not yield performance gains if the original object is still accessed in the hot loop, as V8 optimizes property access well. The real win comes from using SoA to *avoid* accessing the heavy object entirely until it passes the filter (lazy loading).
**Action:** When converting to SoA, ensure the hot loop relies *only* on the parallel arrays and delays accessing the original object until absolutely necessary.

## 2024-05-24 - Defer Eager Lookups in Hot Loops
**Learning:** Even simple array lookups (like `ID_TO_BOOST[types[i]]`) add up in tight loops with high iteration counts (100k+). Deferring them until strictly needed (after a match is confirmed) yielded a ~40% speedup in the fuzzy search hot path.
**Action:** Audit hot loops for eager calculations or lookups that can be made conditional.
