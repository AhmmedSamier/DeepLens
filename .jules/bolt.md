## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration).
**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.

## 2026-04-07 - [Fast Unbounded Queue Reset / Array Shifting]

**Learning:** In worker queues or `pLimit` implementations that advance a `head` index instead of using `Array.prototype.shift()` (which is O(N)), the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Replace `Array.prototype.shift()` with a `head` index integer (`array[head++]`) for O(1) dequeuing. Prevent unbounded memory growth by resetting `head = 0` and `array.length = 0` whenever the queue is completely emptied (`head >= array.length`).

## 2026-04-07 - [O(1) Set Lookups for AST Node Traversal]

**Learning:** In hot paths that traverse an Abstract Syntax Tree (AST), using dynamic string manipulations like `parent.type.toLowerCase().includes('class_declaration')` inside a `while` loop creates redundant memory allocations and slows down the loop significantly.
**Action:** Replace dynamic string manipulations with a static, pre-allocated `Set` of exact node names (e.g., `'class_declaration'`, `'class_definition'`) and use `.has(parent.type)` to achieve O(1) lookups and eliminate string allocation entirely in the loop.

## 2026-04-08 - [Fast Dense Integer Set Tracking]

**Learning:** When keeping track of seen integer IDs that are dense and bounded (e.g. from 0 to N), using `new Set<number>()` incurs heavy allocation and insertion overhead compared to a fixed-size byte array.
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` and use `array[id] = 1` to track presence, which is ~15x faster and avoids garbage collection pauses in hot paths.

## 2026-04-09 - [O(N) to O(K) subset filtering in SearchEngine hot paths]

**Learning:** Iterating over all indexed items (an O(N) operation) in hot paths when we only care about a specific subset (e.g., Files or Endpoints) causes unnecessary overhead. For large repositories, this can mean iterating over hundreds of thousands of items.
**Action:** Replace O(N) full-index iteration with O(K) subset iteration by leveraging pre-populated subset maps/arrays (e.g., `this.fileItemByNormalizedPath.values()`). This eliminates processing unrelated item types during specialized sweeps.

## 2026-04-19 - [Fast Worker Concurrency with Streaming Queue]

**Learning:** In worker threads processing large batches of files, using fixed-chunk arrays mapped with unconstrained `Promise.all` introduces head-of-line blocking. The entire chunk must wait for its slowest file to finish.
**Action:** Replace fixed-chunk `Promise.all` with a concurrency-limited task pool (`pLimit`). Maintain a local accumulator and stream results back (`parentPort?.postMessage`) as soon as a `BATCH_SIZE` worth of items is parsed to keep the parent thread's indexing pipeline saturated.

## 2026-04-21 - [Streaming Indexer Worker Results]

**Learning:** Fixed-chunk processing caused severe head-of-line blocking, idling the main thread's aggregation and delaying partial UI updates.
**Action:** Consistently use `pLimit` in worker threads and stream results back incrementally. Ensure messages are sent securely by immediately resetting accumulator arrays (`pendingItems.length = 0`) after posting to prevent memory bloat.

## 2026-04-23 - [Fast Concurrent Stream Processing via pLimit]

**Learning:** Fixed-chunk `Promise.all` batching in IO/CPU pipelines causes head-of-line blocking, where fast tasks must wait for the slowest task in the array before yielding results, inflating tail latencies.
**Action:** Replace unconstrained or fixed-chunk `Promise.all` iterations with a concurrency-limited task queue (`pLimit`) that streams results as soon as `BATCH_SIZE` items accumulate or processing completes.

## 2026-05-04 - [Fix CI SIGTRAP Failure]

**Learning:** `xvfb-run` crashes with `SIGTRAP` in GitHub Actions for `vscode-extension` integration tests if they run too soon after `dbus` services start or fail, likely due to missing display configurations in the headless agent environment.
**Action:** Implement a retry mechanism or a delay after `dbus` startup to ensure environment stability before launching Electron-based tests.
