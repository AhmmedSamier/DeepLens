## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.

## 2026-04-07 - [Fast Unbounded Queue Reset]

**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.

**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-08 - [Hoist Redundant String Conversions]

**Learning:** In frequently executed hot paths (like key stroke handlers inside VS Code QuickPicks), calling methods like `String.prototype.toLowerCase()` inside a loop that iterates over static configuration maps (like command prefixes) causes redundant, repetitive memory allocations on every iteration. While V8 is fast, allocating strings continuously in rapid UI events leads to GC churn.

**Action:** Cache the result of invariant string manipulations (e.g. `const queryLower = query.toLowerCase()`) _before_ the loop, replacing O(N) string allocations with a single allocation per handler execution.

## 2026-04-13 - [Eliminating Head-of-Line Blocking in Workers]

**Learning:** When processing a large batch of independent asynchronous tasks (like parsing files in a worker thread), using a fixed-chunk `Promise.all` approach creates head-of-line blocking. The entire chunk must wait for the slowest task (e.g., parsing the largest file) to complete before yielding results, artificially inflating latency.

**Action:** Replace fixed-chunk `Promise.all` processing with a concurrency-limited task pool (using `pLimit`). This architecture allows results to stream back to the parent thread continuously as tasks complete, significantly reducing latency. Additionally, when aggregating large datasets returned by these tasks, avoid array spread operators (`push(...items)`) in favor of manual loops to prevent "Maximum Call Stack Size Exceeded" errors.

## 2026-04-12 - [Avoid Spread Syntax for Unbounded Array Push]

**Learning:** When pushing elements from potentially large or unbounded arrays (e.g., aggregated results from parsing many files in a background worker thread), using the array spread operator (`currentBatchItems.push(...items)`) creates a massive risk for stack overflow (`Maximum Call Stack Size Exceeded`). This occurs because JavaScript engines place a hard limit on the number of arguments a function can accept, and the spread syntax expands the array elements into function arguments for `.push()`.

**Action:** Replace `array.push(...items)` with a manual `for` loop (`for(let i=0; i<items.length; i++) array.push(items[i])`) when accumulating dynamically sized, potentially large array results.

## 2026-04-11 - [Eliminate Redundant toLowerCase() in Hot Paths]

**Learning:** In SearchEngine scoring loops, dynamically calling `.toLowerCase()` on item properties causes redundant string allocations and degrades performance.
**Action:** Retrieve pre-computed lowercased strings from parallel Fuzzysort prepared arrays (e.g., `this.preparedFullNames[i]._targetLower`) using `ExtendedPrepared` to eliminate string allocations in the hot loop.

## 2026-04-09 - [Fast Array Filtering]

**Learning:** In performance-critical hot paths, using `Array.prototype.filter()` allocates a new array and incurs the overhead of callback function allocation and execution for every element. While both a manual `for` loop pushing to a new array and `.filter()` allocate exactly one new array, the manual loop entirely avoids the callback execution overhead, resulting in significantly faster execution (up to ~30% faster depending on array size and JS engine optimization).

**Action:** In high-throughput operations where arrays are filtered frequently, replace `Array.prototype.filter()` with a manual `for` loop and `.push()`.

## 2026-04-08 - [Fast Dense Integer Set Tracking]

**Learning:** When keeping track of seen integer IDs that are dense and bounded (e.g. from 0 to N), using `new Set<number>()` incurs heavy allocation and insertion overhead compared to a fixed-size byte array.
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` and use `array[id] = 1` to track presence, which is ~15x faster and avoids garbage collection pauses in hot paths. (Benchmark context: `N=100,000` IDs, `bun` version 1.2.14, Linux x86_64, Intel Xeon 2.30GHz, 4 cores, 8GB RAM, averaged over 100 iterations comparing `Set<number>` addition vs `new Uint8Array(maxIndex)` indexed assignment `array[id] = 1`).
## 2024-11-20 - Fast Array Tracking
**Learning:** In a hot path function like `searchRemainingItems` where a subset of elements is marked as visited, allocating a new `Uint8Array` each time creates unnecessary memory pressure. By re-using a pre-allocated instance-level `Uint8Array` and a secondary array to track the specific mutated indices, the buffer can be safely cleared in O(K) time without zero-filling the entire array, significantly boosting performance in highly iterative scenarios. The implementation should utilize a `try...finally` block to ensure that the tracking array gets reset properly, even if exceptions occur or execution breaks early.
**Action:** Replace `const array = new Uint8Array(size)` inside hot loops with an instance property `this.buffer = new Uint8Array(size)` initialized/grown as needed. Keep track of modifications with a small array `this.tracker = []` and reset only those modified indices in a `finally` block `this.buffer[this.tracker[i]] = 0`.
