## 2026-03-24 - [Avoid Double Splits in String Case Conversion]

**Learning:** When both original and lowercased string segments are needed, the intuitive approach of splitting the lowercased string (`str.toLowerCase().split('/')`) incurs overhead due to duplicating the string allocation and executing a second array splitting operation. Splitting the original string once and mapping the segments via a manual `for` loop and a pre-allocated array (`new Array()`) is ~35% faster. Although splitting a pre-lowercased string is faster than using `.map()` on the segments, using a pre-allocated array avoids the second iteration entirely.
**Action:** When deriving variations (like lowercased versions) of string segments, split the string once and use a manual `for` loop with a pre-allocated array to generate the derived segments, explicitly disabling the `sonarjs/array-constructor` lint rule.
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

## 2024-05-26 - [Fast Array Allocation vs Map]

**Learning:** In hot paths or caching loops (like compiling route segments in `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop avoids function call overhead per element and iterator creation. This significantly reduces allocations and speeds up execution, particularly for repetitive operations.
**Action:** When transforming arrays in performance-sensitive areas, prefer pre-allocating the target array and using a manual `for` loop instead of `.map()`.

## 2024-05-26 - [Fast String Formatting without Arrays]

**Learning:** In string formatting paths (e.g., converting a dot-separated command ID like `workbench.action.files.save` to `Files Save`), replacing `str.split('.').map(...)` and regex replacements (`.replace(/([A-Z])/g, ' $1')`) with a single-pass manual string traversal using `charCodeAt` and slicing significantly reduces intermediate array and string allocations. Even replacing a pre-compiled, cached global regex with a manual loop yielded a ~35% performance improvement in V8/Node.
**Action:** When applying multiple transformations to structured strings (like ID normalization) in hot paths, prefer a single manual loop with `charCodeAt` and `slice` over chained operations like `split().map().join()` and regex replacements.
