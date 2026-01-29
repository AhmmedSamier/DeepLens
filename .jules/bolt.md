## 2024-05-23 - Lazy Object Access with SoA
**Learning:** Pure Struct of Arrays (SoA) conversions (e.g. `item.type` -> `types[i]`) might not yield performance gains if the original object is still accessed in the hot loop, as V8 optimizes property access well. The real win comes from using SoA to *avoid* accessing the heavy object entirely until it passes the filter (lazy loading).
**Action:** When converting to SoA, ensure the hot loop relies *only* on the parallel arrays and delays accessing the original object until absolutely necessary.

## 2024-05-24 - Defer Eager Lookups in Hot Loops
**Learning:** Even simple array lookups (like `ID_TO_BOOST[types[i]]`) add up in tight loops with high iteration counts (100k+). Deferring them until strictly needed (after a match is confirmed) yielded a ~40% speedup in the fuzzy search hot path.
**Action:** Audit hot loops for eager calculations or lookups that can be made conditional.

## 2024-05-25 - Primitive Argument Passing for SoA
**Learning:** Even fast typed array accesses (e.g., `this.itemTypeIds[i]`) have overhead when repeated in tight loops (fuzzy matching). Passing the value as a primitive argument to helper methods yielded a significant speedup (~40%) by avoiding repeated property access and `this` lookups.
**Action:** When using SoA, fetch values once at the top of the loop and pass them down to helper functions.

## 2024-05-26 - Avoid Eager Optimization of Cold Paths
**Learning:** Optimizing `ID_TO_BOOST` lookup by hoisting it before the match check caused a regression because it added overhead to the vast majority of non-matching items (cold path).
**Action:** Always profile whether an "optimization" forces work onto the cold path.

## 2024-05-26 - Float32Array vs Array for Small Lookups
**Learning:** Converting a small (12 items) lookup table from `Array` to `Float32Array` did not yield performance improvements and possibly added overhead (likely boxing/unboxing or boundary checks) in V8.
**Action:** For very small lookup tables used in hot loops, standard JS Arrays are often fast enough or faster due to V8's SMI optimizations.

## 2024-05-26 - Inlining Function Wrappers
**Learning:** Inlining a small wrapper function (`calculateFieldScore`) that checked for null/length before calling a library function (`Fuzzysort.single`) yielded a ~6% speedup in the fuzzy search hot loop by eliminating function call overhead.
**Action:** Inline small, frequent checks in hot loops.

## 2024-05-27 - RegExp vs String.toLowerCase().indexOf()
**Learning:** For case-insensitive substring search, using `new RegExp(escape(needle), 'i').search(haystack)` is significantly faster (~5x) than `haystack.toLowerCase().indexOf(needleLower)` in V8, because it avoids allocating a new lowercased string for the haystack on every check.
**Action:** Replace `haystack.toLowerCase().indexOf(needle)` with RegExp search in hot loops where haystack varies.

## 2024-05-28 - Regex Scanning over Line Slicing
**Learning:** For streaming text search, repeatedly slicing strings from a buffer to check against a regex (even if not matching) is much slower than running a global regex on the buffer first to find match indices. Slicing creates objects and pressure on GC.
**Action:** In stream processing, scan the chunk for tokens/matches first, then only process/slice the lines that contain them.
