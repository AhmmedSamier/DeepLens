<<<<<<< HEAD
## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-08 - [Fast Dense Integer Set Tracking]
**Learning:** When keeping track of seen integer IDs that are dense and bounded (e.g. from 0 to N), using `new Set<number>()` incurs heavy allocation and insertion overhead compared to a fixed-size byte array.
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` and use `array[id] = 1` to track presence, which is ~15x faster and avoids garbage collection pauses in hot paths. (Benchmark context: `N=100,000` IDs, `bun` version 1.2.14, Linux x86_64, Intel Xeon 2.30GHz, 4 cores, 8GB RAM, averaged over 100 iterations comparing `Set<number>` addition vs `new Uint8Array(maxIndex)` indexed assignment `array[id] = 1`).
## 2026-04-08 - [Avoid State Corruption with Reusable Array Trackers]
**Learning:** When using instance-level reusable buffers (like `Uint8Array` combined with a dirty-index list) to replace `new Set<number>()` in hot loops, it is critical to wrap the usage in a `try...finally` block. If the synchronous loop throws an error, the cleanup logic will be skipped, leaving "dirty" indices in the buffer that corrupt subsequent searches for the lifetime of that instance. Additionally, the final fallback pass should only check the buffer—it should never write to it, as no future deduplication passes exist, saving an unnecessary O(N) array write operation.
**Action:** Always place the cleanup/reset of reusable instance-level trackers inside a `finally` block to guarantee state hygiene. Skip writing to the tracker in the final pass of any multi-step search.
## 2026-05-03 - [Fast Array Tracking]
**Learning:** In a hot path function like `searchRemainingItems` where a subset of elements is marked as visited, allocating a new `Uint8Array` each time creates unnecessary memory pressure. By re-using a pre-allocated instance-level `Uint8Array` and a secondary array to track the specific mutated indices, the buffer can be safely cleared in O(K) time without zero-filling the entire array, significantly boosting performance in highly iterative scenarios. The implementation should utilize a `try...finally` block to ensure that the tracking array gets reset properly, even if exceptions occur or execution breaks early.
**Action:** Replace `const array = new Uint8Array(size)` inside hot loops with an instance property `this.buffer = new Uint8Array(size)` initialized/grown as needed. Keep track of modifications with a small array `this.tracker = []` and reset only those modified indices in a `finally` block `this.buffer[this.tracker[i]] = 0`.
## 2026-05-06 - [Precomputing ID to Scope Checks Avoids O(N) Array Allocation]
**Learning:** In `SearchEngine.searchRemainingItems`, allocating an O(N) `Uint8Array` to track visited items for the fallback search pass was a major overhead. Because items are stored in arrays of struct (`this.items`, `this.itemTypeIds`), we can precompute a 256-element boolean lookup array mapping `typeId` to "is in priority scopes" using the `ID_TO_SCOPE` array.
**Action:** Instead of allocating an O(N) array to track which items have been searched, use the item's inherent properties (like `typeId`) and precompute an O(1) lookup table (e.g. `isPriorityTypeId = new Uint8Array(256)`) to filter them on the fly. This avoids large allocations while perfectly preserving the iteration order required by the search ranking logic.
## 2026-05-06 - [Lazy Evaluation of Pre-computed Full Names in Search Engine]
**Learning:** In the `SearchEngine.burstSearch` hot loop, calling `fullName.toLowerCase()` for every item when no fast-path exact or prefix match is found creates a significant amount of redundant string allocations, leading to performance bottlenecks during exhaustive scans.
**Action:** Implemented lazy evaluation of `_targetLower` from the parallel `this.preparedFullNames` array in `calculateMatchScore`. By passing the pre-computed Fuzzysort prepared object down, we only extract its lowercased string if the fast paths fail, avoiding unnecessary O(N) evaluations and memory allocations.
## 2026-05-11 - [Fast Absolute Path Normalization Cache]
**Learning:** In the `SearchEngine`'s hot loops (like filtering modified files or processing symbols within the same file), `path.normalize(filePath)` combined with `toLowerCase()` for Windows is called repeatedly with the same file path. String manipulation in tight loops causes significant garbage collection overhead and CPU cycles.
**Action:** Implemented a 1-item cache (`lastNormalizedInput` and `lastNormalizedOutput`) for absolute path normalization, similar to the existing `relativeFilePath` cache. This avoids redundant string allocations and path processing, yielding a ~45% reduction in time taken for repeated normalizations (1469ms -> 802ms for 1M iterations in micro-benchmarks).
## 2026-06-25 - [Tree-Sitter AST Traversal Optimization]
**Learning:** Checking node types during hot path AST traversals (like finding a parent class) by creating new lowercase strings and running `.includes()` is significantly slower than doing an `O(1)` check against a pre-populated static `Set` of exact node names.
**Action:** When evaluating Tree-sitter AST nodes in loops, always perform exact string matches against a pre-allocated `Set` to eliminate redundant string allocation and garbage collection overhead.
## 2026-06-25 - [Hot path string manipulation optimization]
**Learning:** When checking string prefixes or suffixes in hot paths (like AST traversal node type evaluations), calling `.toLowerCase()` creates redundant string allocations on every node. Furthermore, using `.includes()` requires scanning the whole string. Tree-sitter node types are already typically lowercase snake_case, making the lowercase conversion entirely superfluous.
**Action:** Remove unnecessary `.toLowerCase()` calls. Replace `.includes()` with `.startsWith()`, `.endsWith()`, or strict equality (`===`) checks to optimize execution speed. Avoid extreme micro-optimizations like manual `charCodeAt` checks that sacrifice readability.

## 2026-06-25 - [Optimize Match Score Fast Paths via Single IndexOf Evaluation]
**Learning:** In the `SearchEngine.calculateMatchScore` hot path, combining exact string equality checks and prefix checks using repeated `.indexOf()` calls wastes execution cycles and string traversal overhead. Evaluating `nameLower.indexOf(queryLower)` once and using the returned `index` along with `length` comparisons provides the same semantics while reducing execution time by ~50% in exhaustive multi-pass fallback search loops.
**Action:** When validating substrings or prefixes in highly iterative string-matching loops, perform and capture a single `.indexOf()` operation. Use the index to simultaneously determine the match state, prefix state (`=== 0`), and exact match state (`length` equality), rather than chaining separate validation methods.
## 2026-05-16 - [Fast Bitflag Filtering in Burst Search]
**Learning:** Found a massive performance opportunity in the `burstSearch` method. The codebase already implements an O(1) bitflag filtering system to quickly skip items that don't possess the required characters for a match (`(this.itemBitflags[i] & queryBitflags) !== queryBitflags`). This optimization is properly applied in standard search via `tryFuzzyMatchName` but was completely missing in the highly-executed `findBurstMatches` path, leading to unnecessary string operations (`nameLower.indexOf(...)`) on thousands of irrelevant items.
**Action:** By propagating `queryBitflags` into `findBurstMatches` and checking it *before* running string evaluations, worst-case scans ("no match") improved from ~29ms down to ~1.1ms (~96% speedup), and typical partial-match scans ("S") improved from ~1.8ms down to ~0.6ms (~66% speedup). Always ensure bitflag/bloom-filter heuristics are applied consistently across *all* relevant hot paths, especially dedicated loops like `burstSearch`.

## 2026-05-22 - [Fast Array Pushing to Prevent Call Stack Size Exceeded]
**Learning:** Using the array spread operator (`array.push(...items)`) to merge large or potentially unbounded arrays can cause "Maximum Call Stack Size Exceeded" errors in V8 due to arguments limit. Furthermore, it introduces significant performance overhead (e.g., ~2x slower) compared to a simple manual `for` loop pushing elements one by one.
**Action:** Always replace `array.push(...items)` with a manual `for` loop (`for (let i = 0; i < items.length; i++) array.push(items[i]);`) when dealing with aggregated arrays, parsing results, or task queues.

## 2026-05-22 - [Optimize Sorting Complexity with Pre-computed Sets]
**Learning:** Performing O(N) array membership checks (like `Array.includes`) inside an array sort comparator creates an overall complexity of O(M log M * N). In components like `SlashCommandService`, this approach leads to unnecessary execution overhead during sorting operations.
**Action:** Before executing `.sort()`, convert arrays used for priority or membership checks into a `Set`. This replaces the O(N) lookup inside the sort loop with an O(1) `Set.has()` check, improving the overall sorting complexity to O(M log M + N).
## 2024-05-23 - Fast Tree-sitter Node Type Matching
**Learning:** Replacing unanchored regex matchers (like `/class_declaration/`) with `===` causes critical regressions across different AST grammars, because Tree-sitter uses prefixes like `abstract_class_declaration` or `local_variable_declaration`.
**Action:** When migrating away from regex in Tree-sitter node type checks, always use `.endsWith()` alongside strict equality (`===`) to preserve prefix compatibility while still benefiting from significant string-matching performance gains.

## 2026-07-01 - [Fast Substring Extraction in Workspace Indexer]
**Learning:** To improve performance when extracting a substring up to a delimiter (e.g., the first line of a file content buffer), using `content.split('\n')[0]` creates unnecessary memory overhead because it allocates an array of strings representing every chunk in the string.
**Action:** Replace `content.split('\n')[0]` with `content.indexOf('\n')` combined with `content.slice(0, index)`. This avoids allocating an array of strings representing every chunk in the string, heavily reducing memory overhead and garbage collection during hot paths like workspace indexing.
## 2026-06-01 - [Avoid O(n) early-exits inside helper functions in hot loops]
**Learning:** [Insight] When applying early exits to O(N) hot loops, placing the early exit condition *inside* a helper function (like `calculateScore`) still incurs function call and variable assignment overhead for every item.
**Action:** [How to apply next time] Move simple boolean or bitmask early-exit checks to the very top of the calling loop method (like `processItemForSearch`) to skip function calls entirely for non-matching items.
## 2026-07-15 - [Fast Scalar Tracking in Sequential Hot Loops]
**Learning:** In synchronous, single-threaded hot loops that process items sequentially (like `SearchEngine.processItemForSearch`), allocating an O(N) array on the parent context to track temporary per-item data (e.g., `new Array(this.items.length)` for fuzzy search highlights) creates massive and entirely unnecessary memory churn. Because items are evaluated and immediately pushed to a heap one by one, a single tracking variable is sufficient.
**Action:** Replace `new Array(this.items.length)` with a simple scalar context variable (e.g., `currentHighlights`) and reset it to `null` at the start of each iteration. This eliminates a huge memory allocation per request, dropping GC pauses and overhead significantly during rapid typing scenarios.
## 2026-07-28 - [O(1) Early-Exit Optimization in Item Processing]
**Learning:** In the `SearchEngine.processItemForSearch` method, calling `calculateSearchScore` adds a function call overhead for every evaluated item, even if the item is instantly rejected by the subsequent bitmask check.
**Action:** Moving the O(1) bitflag early-exit check (`(context.itemBitflags[i] & context.queryBitflags) !== context.queryBitflags)` to the very top of `processItemForSearch` avoids unnecessary function call overhead (`calculateSearchScore`) and `typeId` lookups for the vast majority of items that do not contain the required characters, yielding a measurable performance gain in the hot path.
## 2025-05-25 - [Fast Route Matcher Endpoint Fallback Bypass]
**Learning:** Found an inefficiency where `calculateSearchScore` was called unconditionally for endpoint items even if they did not pass the bitflag characters match. The bitflag check was skipped to allow for parameterized `RouteMatcher` evaluations, but `calculateSearchScore` was still evaluated and returning -Infinity when fuzzy scoring failed.
**Action:** Used the `passesBitflag` boolean to conditionally bypass `calculateSearchScore` when evaluating items that failed the characters check but were preserved for route matching, avoiding wasted cycles.

## 2026-06-04 - [Defer Property Array Reads in Hot Paths]
**Learning:** In hot loops, evaluating boolean expressions and reading from parallel arrays (like `itemTypeIds`) before an early-exit check incurs unnecessary memory access and condition evaluation overhead for items that are immediately rejected.
**Action:** Defer reading from property arrays and complex conditional logic until *after* cheap O(1) early-exit checks (like bitflags) have passed. This prevents wasted cycles and memory access.
## 2026-08-01 - [Fast Name Property Early-Exit]
**Learning:** Even if an item passes the aggregate bitflag check (`itemBitflags`) which considers the `name`, `fullName`, and `relativeFilePath`, we shouldn't immediately assume the `name` property itself contains all the characters. The fallback path runs `tryFuzzyMatchName` for all items passing the aggregate bitmask, resulting in wasted `Fuzzysort.single` evaluations.
**Action:** Since we already maintain `itemNameBitflags` specific to the `name` property, we can add a second O(1) early-exit check inside `tryFuzzyMatchName` (`(context.itemNameBitflags[i] & context.queryBitflags) !== context.queryBitflags`). This immediately skips expensive name evaluation when the query characters are actually spread across the full name or file path.

## 2026-06-25 - [Fast Array Element Removal in reverse index]
**Learning:** When removing elements from unordered arrays (like reverse indices `fileToItemIndices`), using `Array.splice(index, 1)` causes a severe O(N) performance regression due to element shifting.
**Action:** Use a fast O(1) swap-and-pop technique (`array[index] = array[array.length - 1]; array.pop();`) to remove items from unordered arrays.

## 2024-05-27 - Fast String Splitting in Hot Paths
**Learning:** In string parsing hot paths (like RouteMatcher's path evaluation), relying on `String.prototype.split('/')` incurs significant memory allocation overhead for single-segment strings because it instantiates an array and performs internal string operations regardless of whether a delimiter is present.
**Action:** Implement an early return using `String.prototype.indexOf('/') === -1` combined with an explicit string length check. If true, manually allocate and return the required single-element arrays. This avoids the overhead of `.split()` and dynamically sized arrays entirely for simpler inputs, providing a measurable performance boost.

## 2024-06-24 - String checking performance
**Learning:** To improve performance when checking for substring presence in hot paths or large strings, use `.indexOf('target') !== -1` instead of `.includes('target')`. `indexOf` avoids the abstraction overhead of `.includes`.
**Action:** Use `.indexOf` over `.includes` in performance-critical sections.

## 2024-06-20 - [Fast FullName Property Early-Exit]
**Learning:** Similar to the name property early-exit, even if an item passes the aggregate bitflag check (`itemBitflags`) which considers the `name`, `fullName`, and `relativeFilePath`, we shouldn't immediately assume the `fullName` property itself contains all the characters. The fallback path runs `tryFuzzyMatchFullName` for items, resulting in wasted `Fuzzysort.single` evaluations if the query characters matched due to other fields.
**Action:** Added `itemFullNameBitflags` to track bitflags specifically for the `fullName` property, enabling a second O(1) early-exit check inside `tryFuzzyMatchFullName` (`(context.itemFullNameBitflags[i] & context.queryBitflags) !== context.queryBitflags`). This immediately skips expensive evaluation when the query characters are actually spread across the name or file path.

## 2026-08-05 - [O(1) FullName Property Early-Exit in Fuzzy Match]
**Learning:** Checking `itemNameBitflags` is an effective early exit for `name` matches, but when falling back to `tryFuzzyMatchFullName`, the evaluation proceeds directly to expensive `Fuzzysort.single()` string operations. Since `fullName` can differ from `name`, and characters might be spread purely across the `relativeFilePath` (passing the `itemBitflags` aggregate check but not existing in `fullName`), missing an explicit `fullName` bitflag check results in wasted fuzzy search cycles.
**Action:** Isolate and maintain an `itemFullNameBitflags` array in hot paths, parallel to `itemNameBitflags` and `itemBitflags`. Use this specific bitmask to implement an O(1) early-exit check inside `tryFuzzyMatchFullName` before executing expensive string evaluations.

## 2026-10-27 - [Fast Endpoint Matching Bypass]
**Learning:** In the `SearchEngine.processItemForSearch` method, `tryUrlEndpointMatch` was previously called for all items that passed the bitflag check or were preserved for URL evaluation, regardless of whether the item was actually an endpoint. This added unnecessary function call overhead and duplicate condition evaluations for non-endpoint items.
**Action:** Add an explicit O(1) `typeId === 11 /* ENDPOINT */` check alongside `context.isPotentialUrl` directly inside `processItemForSearch` to completely bypass the `tryUrlEndpointMatch` function call for all non-endpoint items. This eliminates redundant evaluations and speeds up the fallback search path.
## 2024-05-28 - Fast Git Status Parsing
**Learning:** Running multiple git commands (`git diff`, `git diff --cached`, `git ls-files`) concurrently incurs significant child process spawn overhead. Replacing these with a single `git status --porcelain -z` call is faster, and parsing its null-terminated string using `.indexOf('\0')` and `.slice()` provides a large performance boost over splitting by newline.
**Action:** Always prefer a single `git status --porcelain -z` command over multiple diffs, and use manual null-terminated string parsing (`indexOf`, `slice`) to avoid intermediate string array allocations.
## 2024-05-28 - Accurate Fast Git Status Parsing
**Learning:** Using `git status --porcelain -z` without the `-uall` flag causes it to omit untracked files inside untracked directories, breaking parity with `git ls-files --others`. Also, when handling 'R' and 'C' rename statuses in porcelain v1, you must evaluate both the X (index) and Y (working tree) characters of the status prefix, and then ensure the old path string is also captured and added.
**Action:** Always use `-uall` with `git status --porcelain -z` when tracking modified/untracked files, and correctly verify `statusX` and `statusY` before extracting the old path segment.
## 2025-05-18 - Avoid function call overhead in hot loops
**Learning:** Placing condition checks like bitmask matching inside helper functions during hot-loop iteration introduces unnecessary function call overhead for immediately rejected items.
**Action:** Lift boolean filtering checks (like `itemNameBitflags[i] & queryBitflags`) into the caller loops to short-circuit function dispatch for disqualified items.
