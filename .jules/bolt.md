## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-16 - [Fast Result Streaming Without Allocation Overhead]
**Learning:** In worker thread environments handling large data structures (like AST parsing), accumulating an entire batch of results using a fixed-chunk `Promise.all` causes head-of-line blocking (one slow file blocks the whole chunk) and delays time-to-first-result. While replacing `Promise.all` with a concurrency queue (e.g., `pLimit`) allows streaming results continuously, you must carefully handle pushing the incoming item arrays to the batch array. Using `array.push(...items)` on large AST result sets can throw `Maximum Call Stack Size Exceeded` and allocates unnecessary intermediate iterators.
**Action:** Use a concurrency limit queue (`pLimit`) instead of `Promise.all(chunk.map)` to process items efficiently, and always use a manual `for` loop to append incoming sub-arrays into the batch accumulator (`batchItems.push(items[i])`) to prevent call stack crashes and allocation overhead.
