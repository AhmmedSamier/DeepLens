## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.

## 2026-04-07 - [Fast Unbounded Queue Reset]

**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-08 - [Fast Dense Integer Set Tracking]

**Learning:** When keeping track of seen integer IDs that are dense and bounded (e.g. from 0 to N), using `new Set<number>()` incurs heavy allocation and insertion overhead compared to a fixed-size byte array.
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` and use `array[id] = 1` to track presence, which is ~15x faster and avoids garbage collection pauses in hot paths. (Benchmark context: `N=100,000` IDs, `bun` version 1.2.14, Linux x86_64, Intel Xeon 2.30GHz, 4 cores, 8GB RAM, averaged over 100 iterations comparing `Set<number>` addition vs `new Uint8Array(maxIndex)` indexed assignment `array[id] = 1`).

## 2026-04-25 - [Fast Concurrent Batch Processing in Workers]
**Learning:** In worker threads switching from fixed-chunk Promise.all/fixed-chunk mapping to a concurrency-limited task pool (pLimit), tasks resolve out of order. Relying on the original mapped array index (index === array.length - 1) to signal the final flush creates an out-of-order completion bug (premature termination signal). This occurs because when using a concurrency-limited task pool (pLimit), the task at the highest array index no longer guarantees being the last to finish; the logic fails because it incorrectly assumes completion order matches array order, which is not guaranteed by pLimit.
**Action:** Replace fixed-chunk Promise.all with a bounded concurrency pool (using pLimit). Maintain a totalCompleted counter incremented in the finally block of each task, and trigger the final batch flush when totalCompleted === array.length to guarantee all data is safely streamed.

## 2026-04-29 - [Fast Tree-Sitter Node Type Checks via Sets]

**Learning:** In hot paths like AST traversal and node type mapping (e.g., `getSearchItemType`), repeatedly executing `RegExp.test()` against a small set of known literal strings (like `"class_declaration"`) adds significant overhead due to regex engine execution and matching.
**Action:** Replace `RegExp.test()` matching with `Set.has()` lookups against pre-allocated `Set<string>` instances for O(1) exact matching. This eliminates regex overhead in hot loops and performs measurably faster. (Benchmark context: 1M iterations evaluating 10 input node types, bun 1.2.14, Linux x86_64, Intel Xeon 2.30GHz, 4 cores, 8GB RAM. Result: RegExp ~2638ms vs Set ~761ms, ~3.4x faster).

## 2026-04-10 - [Avoid Unrolling Maps to For Loops]
**Learning:** While replacing the spread operator in `.push(...items)` with manual `.push` in a `for` loop resolves stack overflow errors on huge arrays, manually unrolling `Array.prototype.map()` into `for` loops (e.g., `const newItems = new Array(len); for...`) is considered an anti-pattern. It introduces micro-optimizations that sacrifice code readability and trigger linting errors (like `sonarjs/array-constructor`) without a universally measurable performance win to justify the complexity.
**Action:** Do not sacrifice readability for micro-optimizations. When dealing with arrays in UI components or where sizes are modest, stick to native array methods like `.map()` and prioritize clear, maintainable code over unrolled loops.
## 2026-04-09 - [Dense Index Tracking via Uint8Array]

**Learning:** When tracking visited or candidate dense integer indices (e.g. from 0 to N where N is large), using `new Set<number>()` in hot loops causes massive object allocation overhead and garbage collection pauses. Pre-allocating a `Uint8Array` of size N and using array indexing (`array[id] = 1`) provides O(1) access and avoids object creation bottlenecks, significantly improving performance for bounded integers. (Benchmark context: 1M items, ~15x faster than Set).
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` for tracking dense boolean states in bounded numerical arrays to reduce memory overhead and speed up array iterations.

## 2026-04-23 - [Fast Concurrent Stream Processing via pLimit]

**Learning:** Fixed-chunk `Promise.all` batching in IO/CPU pipelines (e.g., worker threads) causes head-of-line blocking, where fast tasks must wait for the slowest task in the array before yielding results, which inflates tail latencies and slows down UI updates.
**Action:** Replace unconstrained or fixed-chunk `Promise.all` iterations with a concurrency-limited task queue (e.g., `pLimit`) that pushes to a shared array and streams results as soon as `BATCH_SIZE` items accumulate or processing completes. This maximizes throughput without blocking.
## 2026-05-11 - [Instance-level Tracker Array Reuse]
**Learning:** In multi-pass fallback operations like `SearchEngine.searchAllItems` or `SearchEngine.searchWithIndices`, tracking visited indices dynamically per-request using `new Uint8Array(n)` creates massive object allocation overhead and GC pressure. For large data sets (e.g. 100,000+ items), this severely degrades burst search performance.
**Action:** Replace dynamically instantiated arrays with an instance-level pre-allocated tracker (`this.visitedBuffer = new Uint8Array(n)`) alongside a tracking array for indices to reset (`this.visitedIndicesBuffer = []`). Always use a `try...finally` block to guarantee the buffer is cleanly reset (`buffer[i] = 0`) across requests to avoid state corruption while eliminating allocation pauses.

## 2024-06-25 - Tree-Sitter AST Traversal Optimization
**Learning:** Checking node types during hot path AST traversals (like finding a parent class) by creating new lowercase strings and running `.includes()` is significantly slower than doing an `O(1)` check against a pre-populated static `Set` of exact node names.
**Action:** When evaluating Tree-sitter AST nodes in loops, always perform exact string matches against a pre-allocated `Set` to eliminate redundant string allocation and garbage collection overhead.
