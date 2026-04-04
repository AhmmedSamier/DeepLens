## 2026-03-20 - [Fast RegExp over string toLowerCase and chained includes]

**Learning:** In hot paths checking for multiple string substrings (e.g., parsing HTTP method attributes), using a single case-insensitive Regular Expression (`/.../i.exec(text)`) is significantly faster than allocating a new lowercased string (`.toLowerCase()`) and chaining multiple `.includes()` checks. It avoids creating short-lived strings and avoids scanning the string multiple times.
**Action:** Replace multiple `str.toLowerCase().includes(...)` chains with a single case-insensitive `RegExp.exec()` for faster pattern matching in hot paths.

## 2026-03-20 - [Fast String Traversal Over Regex/Split]

**Learning:** In high-performance string processing (e.g., parsing multi-line command outputs like Git status), replacing `.split('\n')` and `.trim()` with manual single-pass loops using `.indexOf('\n')` and `.charCodeAt()` boundaries, and substituting `path.normalize(path.join())` with direct string concatenation, significantly reduces intermediate allocations and execution time (~2x speedup observed).
**Action:** When repeatedly splitting large output blocks, use manual `indexOf` string index traversal and primitive character boundary checks rather than regex or `Array.prototype.split`.

## 2024-05-27 - [Fast Array Pre-allocation for RouteMatcher Params]

**Learning:** In hot paths (like checking template segments for parameters in `RouteMatcher.getOrCompileCache`), mapping an array with `.map()` incurs significant closure creation and iterator overhead. Pre-allocating the boolean array (`new Array<boolean>(length)`) and populating it via a `for` loop is considerably faster, dropping `RouteMatcher` search time from ~50ms to ~33ms over 100 iterations.
**Action:** When calculating derived arrays inside hot path caching or validation loops, always favor manual `for` loops with pre-allocated arrays (using the explicit `eslint-disable-next-line sonarjs/array-constructor` directive) instead of the functional `.map()` method.

## 2024-05-26 - [Fast Array Pre-allocation over Map]

**Learning:** In hot paths (like `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop avoids function call and iterator creation overhead, resulting in measurable performance gains in route pattern precomputation.
**Action:** Use pre-allocated arrays and manual loops instead of `.map()` in performance-sensitive hot loops, explicitly disabling the `sonarjs/array-constructor` lint rule as needed.

## 2024-05-27 - [Avoid Chained Array Operations]

**Learning:** In paths where a unique collection of objects is needed from a Map or an Array (like extracting unique commands in `getCommands`), using chained operations like `Array.from(new Set(Array.from(map.values()).map(c => c.name))).map(...)` creates multiple intermediate arrays, sets, and requires multiple iterations. Replacing these with a single-pass `for...of` loop and a `Set` to track seen properties (e.g., `seen.has(cmd.name)`) is significantly faster (~5x in V8/Node) as it avoids unnecessary allocations and iterations.
**Action:** When extracting or filtering unique items based on a property from a collection, avoid chained `Array.from()`, `map()`, and `filter()` operations. Use a single manual loop with a `Set` to track uniqueness instead.

## 2026-03-11 - [Fast Array Pre-allocation]

**Learning:** In hot paths (like `RouteMatcher.getOrCompileCache`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop is significantly faster. Avoiding `.map()` eliminates the callback overhead and memory allocations for the new array elements, resulting in ~15-20% faster boolean array creation. Also, avoid using `Array.from({ length })` for array pre-allocation, as it introduces substantial overhead and acts as an anti-optimization compared to `.map()`.

**Action:** When creating fixed-size arrays from existing arrays in performance-critical sections, prefer using `new Array(length)` with a manual `for` loop over `.map()`. Remember to bypass the SonarJS rule with `// eslint-disable-next-line sonarjs/array-constructor`. Use pre-allocated arrays with a manual loop for array mappings in critical hot paths, remembering to explicitly disable the `sonarjs/array-constructor` lint rule when doing so.

## 2024-05-26 - [Fast Array Allocation vs Map]

**Learning:** In hot paths or caching loops (like compiling route segments in `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop avoids function call overhead per element and iterator creation. This significantly reduces allocations and speeds up execution, particularly for repetitive operations.
**Action:** When transforming arrays in performance-sensitive areas, prefer pre-allocating the target array and using a manual `for` loop instead of `.map()`.

## 2024-05-26 - [Fast String Formatting without Arrays]

**Learning:** In string formatting paths (e.g., converting a dot-separated command ID like `workbench.action.files.save` to `Files Save`), replacing `str.split('.').map(...)` and regex replacements (`.replace(/([A-Z])/g, ' $1')`) with a single-pass manual string traversal using `charCodeAt` and slicing significantly reduces intermediate array and string allocations. Even replacing a pre-compiled, cached global regex with a manual loop yielded a ~35% performance improvement in V8/Node.
**Action:** When applying multiple transformations to structured strings (like ID normalization) in hot paths, prefer a single manual loop with `charCodeAt` and `slice` over chained operations like `split().map().join()` and regex replacements.

## 2026-03-30 - [Fast Prefix Verification Over Upper-casing]

**Learning:** In hot paths checking for multiple specific string prefixes or substrings (e.g., parsing HTTP methods), using a single pre-compiled case-insensitive Regular Expression (e.g. `!/^(?:GET|POST|PUT)$/i.test(text)`) is significantly faster than allocating a new lowercased/uppercased string (`.toUpperCase()`) and chaining multiple `.includes()` or using a `switch` block. This eliminates intermediate string allocations and validation loops, providing an ~30-40% speedup.
**Action:** When evaluating short string prefixes or exact matches in performance-sensitive logic against a known set of keywords, prefer a single case-insensitive Regex over manual slice-and-uppercase combinations.

## 2026-04-04 - [Fast Empty Query Filtering Optimization]

**Learning:** In `SearchEngine.handleEmptyQuerySearch`, applying scope filters (e.g., `OPEN` or `MODIFIED`) within the provider iteration pass rather than using `Array.prototype.filter()` on the aggregated results avoids unnecessary O(N) array allocations. Pre-fetching required filter data (like a Set of modified files) before the loop minimizes async overhead. This also prevents a bug where the search might return fewer than `maxResults` items if matches were found but subsequently filtered out after the loop was broken early.
**Action:** When aggregating results from multiple providers with an early break condition, apply filters sequentially during iteration rather than as a post-processing step.

## 2026-04-03 - [Fast String Splitting Over Regex/split]

**Learning:** In high-performance string processing for extremely large command output strings (like Ripgrep stdout or Git commands), using `String.prototype.split('\n')` or `String.prototype.split(/\r?\n/)` causes excessive intermediate array and string allocations. Replacing it with a single-pass manual loop using `indexOf('\n')`, `charCodeAt`, and `slice` significantly reduces memory overhead and improves performance.
**Action:** When parsing large, multi-line command output payloads, replace regex-based splits and manual trims with a single-pass loop utilizing `indexOf('\n')` and `charCodeAt` boundaries to minimize allocations.
