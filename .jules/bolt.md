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
**Action:** In stream processing, scan the chunk for tokens/matches first, only process/slice the lines that contain them.

## 2024-05-29 - Manual String Building vs Regex
**Learning:** Replacing eager string manipulation with regex (`text.slice(1).replace(/[^A-Z]/g, '').toUpperCase()`) with a manual loop and char code checks yielded a ~4.6x speedup in isolation and ~10% improvement in overall indexing time (100k items). Regex overhead and intermediate string allocations add up in hot paths like indexing.
**Action:** For simple string transformations in critical loops (like startup or indexing), prefer manual loops over regex-based string methods.

## 2026-01-28 - Manual Inlining of Hot Loop Logic
**Learning:** In extremely hot loops (100k+ iterations), even the overhead of calling a closure function (captured variables) can be significant (e.g., 10-20% of execution time). Manually inlining the logic into the `for` loop body, even if it requires code duplication, can yield substantial gains when the function body is small/medium but called frequently.
**Action:** Consider manual inlining for critical hot loops where function call overhead is a bottleneck, but document the duplication clearly.

## 2024-05-26 - Lazy Object Access in Burst Search
**Learning:** In `burstSearch`, checking `preparedNamesLow` (parallel array) *before* accessing `this.items[i]` (object) reduced the "no match" scan time by ~4% (4.13ms -> 3.97ms for 50k items). While skipping object access is faster, ensuring robustness (fallback for missing cache) adds slight overhead but maintains correctness.
**Action:** When iterating parallel arrays, use them as a fast path filter but ensure a fallback path exists if data synchronization is not guaranteed.

## 2024-05-23 - CamelHumps Priority
**Learning:** When multiple search strategies are available, running the cheaper, more specific strategy (CamelHumps) *first* and skipping the expensive general strategy (Fuzzy) if a strong match is found can significantly reduce CPU time (20%+ speedup) for matching queries.
**Action:** Always order search strategies from cheapest/most-specific to most expensive, and implement early exit thresholds where possible.

## 2024-05-30 - Inlining Closures in Unified Search
**Learning:** Inlining the `processIndex` closure and its helpers (`computeFuzzyScoreLocal`, `computeCamelHumpsScoreLocal`) directly into the `performUnifiedSearch` loop resulted in a ~21% speedup for 60k items. The overhead of calling closures inside a hot loop is measurable.
**Action:** When a loop iterates 10k+ times, prefer inlining logic over clean closure abstractions if performance is critical.

## 2024-06-03 - Strategy Reordering with Inlining
**Learning:** Combining manual loop inlining with strategy reordering (CamelHumps > Fuzzy) yielded a ~8% speedup in unified search. Inlining avoids closure overhead in the hot loop, and checking the cheap CamelHumps match first allows skipping the expensive fuzzy match for abbreviations.
**Action:** For critical search loops, inline helper functions and prioritize cheap/exact match checks to short-circuit expensive logic.

## 2026-01-28 - Manual Inlining in Bun (JSC)
**Learning:** Manually inlining a large closure body (with nested logic) into a hot loop in Bun (JavaScriptCore) caused a performance regression (~2x slowdown) compared to keeping it as a closure. This contrasts with V8 behavior where eliminating closure overhead is often beneficial.
**Action:** In Bun/JSC environments, verify manual inlining impact carefully; the engine might optimize small closures better than large monolithic functions.

## 2026-01-28 - Small File Reading in Bun
**Learning:** For small files (< 50KB), `fs.promises.readFile` is significantly faster (~3x) than `fs.createReadStream` with manual chunk processing in Bun. Stream overhead (events, buffer concatenation) dominates for tiny payloads.
**Action:** Use `readFile` for small files in text search hot paths.

## 2025-05-23 - Reordering Filter Checks for SoA Efficiency
**Learning:** In a hot loop (50k+ items), checking a fast bitwise filter (Struct of Arrays `itemBitflags`) *before* checking a property on a heap object (`pName.target.length`) yields a ~10% speedup by avoiding pointer chasing and potential cache misses for non-matching items.
**Action:** Always place the cheapest and most cache-friendly checks (scalars, typed arrays) before checks requiring object property access or dereferencing.

## 2025-05-24 - Pre-check String Length in CamelHumps
**Learning:** Adding a simple integer length check (`queryLen <= capitals.length`) before calling `indexOf` in the CamelHumps hot loop yielded a ~25% speedup for non-matching queries (which are frequent). `indexOf` overhead is measurable even for short strings in tight loops.
**Action:** Always validate length constraints before performing substring searches in hot loops.

## 2026-01-29 - Manual Inlining in Bun (Corrected)
**Learning:** Contrary to previous findings, manual inlining of `processIndex` logic into the `performUnifiedSearch` loop, combined with strict name bitflag checking (`itemNameBitflags`), yielded massive speedups in Bun (~40-60%). The overhead of capturing many variables in a closure (`items`, `preparedNames`, etc.) likely outweighed any JIT benefits of the closure.
**Action:** Trust manual inlining for hot loops with heavy context capture, even in Bun.
