## 2024-05-27 - [Avoid Chained Array Operations]

**Learning:** In paths where a unique collection of objects is needed from a Map or an Array (like extracting unique commands in `getCommands`), using chained operations like `Array.from(new Set(Array.from(map.values()).map(c => c.name))).map(...)` creates multiple intermediate arrays, sets, and requires multiple iterations. Replacing these with a single-pass `for...of` loop and a `Set` to track seen properties (e.g., `seen.has(cmd.name)`) is significantly faster (~5x in V8/Node) as it avoids unnecessary allocations and iterations.
**Action:** When extracting or filtering unique items based on a property from a collection, avoid chained `Array.from()`, `map()`, and `filter()` operations. Use a single manual loop with a `Set` to track uniqueness instead.

## 2026-03-11 - [Fast Array Pre-allocation]

**Learning:** In hot paths (like `RouteMatcher.getOrCompileCache`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop is significantly faster. Avoiding `.map()` eliminates the callback overhead and memory allocations for the new array elements, resulting in ~15-20% faster boolean array creation. Also, avoid using `Array.from({ length })` for array pre-allocation, as it introduces substantial overhead and acts as an anti-optimization compared to `.map()`.

**Action:** When creating fixed-size arrays from existing arrays in performance-critical sections, prefer using `new Array(length)` with a manual `for` loop over `.map()`. Remember to bypass the SonarJS rule with `// eslint-disable-next-line sonarjs/array-constructor`. Use pre-allocated arrays with a manual loop for array mappings in critical hot paths, remembering to explicitly disable the `sonarjs/array-constructor` lint rule when doing so.

## 2026-03-11 - [Fast Array Pre-allocation]

**Learning:** In hot paths (like `RouteMatcher.getOrCompileCache`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop is significantly faster. Avoiding `.map()` eliminates the callback overhead and memory allocations for the new array elements, resulting in ~15-20% faster boolean array creation. Also, avoid using `Array.from({ length })` for array pre-allocation, as it introduces substantial overhead and acts as an anti-optimization compared to `.map()`.

**Action:** When creating fixed-size arrays from existing arrays in performance-critical sections, prefer using `new Array(length)` with a manual `for` loop over `.map()`. Remember to bypass the SonarJS rule with `// eslint-disable-next-line sonarjs/array-constructor`. Use pre-allocated arrays with a manual loop for array mappings in critical hot paths, remembering to explicitly disable the `sonarjs/array-constructor` lint rule when doing so.
