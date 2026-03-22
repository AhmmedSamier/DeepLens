## 2024-05-27 - [Avoid Chained Array Operations]

**Learning:** In paths where a unique collection of objects is needed from a Map or an Array (like extracting unique commands in `getCommands`), using chained operations like `Array.from(new Set(Array.from(map.values()).map(c => c.name))).map(...)` creates multiple intermediate arrays, sets, and requires multiple iterations. Replacing these with a single-pass `for...of` loop and a `Set` to track seen properties (e.g., `seen.has(cmd.name)`) is significantly faster (~5x in V8/Node) as it avoids unnecessary allocations and iterations.
**Action:** When extracting or filtering unique items based on a property from a collection, avoid chained `Array.from()`, `map()`, and `filter()` operations. Use a single manual loop with a `Set` to track uniqueness instead.

## 2024-05-26 - [Fast Array Pre-allocation]

**Learning:** In hot paths (like `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop is significantly faster. Avoid using `Array.from({ length })` for array pre-allocation, as it introduces substantial overhead and acts as an anti-optimization compared to `.map()`.
**Action:** Use pre-allocated arrays with a manual loop for array mappings in critical hot paths, remembering to explicitly disable the `sonarjs/array-constructor` lint rule when doing so.

## 2024-05-25 - [Fast Regex Escaping]

**Learning:** In V8/Node.js hot paths (like executing text streams where search relies on escaped string patterns), replacing regex-based string replacements
(e.g., `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) with a manual `for` loop that checks character boundaries using `charCodeAt` and appends chunks via `.slice()` is up to 3-4x faster. The manual loop avoids regex compilation, execution overhead, and reduces string allocations.
**Action:** When escaping characters or doing replacements in hot loops, prefer a manual loop using `charCodeAt` and `slice` over regex string replacement, as it provides measurable speed improvements.

## 2024-05-25 - [Fast Regex Escaping Lookup Table]

**Learning:** In V8/Node.js hot paths (like executing text streams where search relies on escaped string patterns), replacing regex-based string replacements (e.g., `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) with a manual `for` loop that checks character boundaries using `charCodeAt` against a pre-initialized `Uint8Array` lookup table and appends chunks via `.slice()` is up to 3-4x faster. The manual loop avoids regex compilation, execution overhead, and reduces string allocations. Using a lookup table (`Uint8Array`) is slightly faster than chaining boolean comparisons in a long `if` statement.
**Action:** When escaping characters or doing replacements in hot loops, prefer a manual loop using `charCodeAt` and `slice` over regex string replacement, and utilize a `Uint8Array` lookup table to check characters if there are many to check.

## 2024-05-24 - [Fast Backslash Normalization in Hot Paths]

**Learning:** In hot paths (like path normalization during ingestion or search), replacing `.replaceAll('\\', '/')` with an early check `.indexOf('\\') !== -1` followed by `.replace(/\\/g, '/')` is roughly 20-30% faster in Node/V8 and Bun. The chained `replaceAll` or `split.join` incur extra overhead. Furthermore, for C#-generated file checks, `includes` checks coupled with custom reverse `charCodeAt` slicing avoids full string allocation and splitting, resulting in ~15% faster checks.
**Action:** When normalizing file paths in loops or ingestion code, prefer checking for the existence of the character using `indexOf` or `includes` before applying a global regex `replace`. Also avoid full path manipulation (like `replaceAll` then `split`) when checking extensions.

## 2024-05-24 - [Fast URL Segment Processing]

**Learning:** In URL routing paths (`RouteMatcher.prepare`), calling `split('/')` on a pre-lowercased string (`cleanPath.toLowerCase().split('/')`) is ~25% faster than splitting first and then applying `toLowerCase()` to each array element using `map`. Map operations allocate memory per element.
**Action:** Apply global string operations (like `toLowerCase()`) _before_ splitting into arrays when you need an array of modified strings, as long as the operation is safe to apply globally.

## 2024-05-26 - [Fast Array Allocation vs Map]

**Learning:** In hot paths or caching loops (like compiling route segments in `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop avoids function call overhead per element and iterator creation. This significantly reduces allocations and speeds up execution, particularly for repetitive operations.
**Action:** When transforming arrays in performance-sensitive areas, prefer pre-allocating the target array and using a manual `for` loop instead of `.map()`.

## 2024-05-26 - [Fast String Formatting without Arrays]

**Learning:** In string formatting paths (e.g., converting a dot-separated command ID like `workbench.action.files.save` to `Files Save`), replacing `str.split('.').map(...)` and regex replacements (`.replace(/([A-Z])/g, ' $1')`) with a single-pass manual string traversal using `charCodeAt` and slicing significantly reduces intermediate array and string allocations. Even replacing a pre-compiled, cached global regex with a manual loop yielded a ~35% performance improvement in V8/Node.
**Action:** When applying multiple transformations to structured strings (like ID normalization) in hot paths, prefer a single manual loop with `charCodeAt` and `slice` over chained operations like `split().map().join()` and regex replacements.
