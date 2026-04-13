## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).
## 2026-04-13 - [Eliminating Head-of-Line Blocking in Workers]

**Learning:** When processing a large batch of independent asynchronous tasks (like parsing files in a worker thread), using a fixed-chunk `Promise.all` approach creates head-of-line blocking. The entire chunk must wait for the slowest task (e.g., parsing the largest file) to complete before yielding results, artificially inflating latency.

**Action:** Replace fixed-chunk `Promise.all` processing with a concurrency-limited task pool (using `pLimit`). This architecture allows results to stream back to the parent thread continuously as tasks complete, significantly reducing latency. Additionally, when aggregating large datasets returned by these tasks, avoid array spread operators (`push(...items)`) in favor of manual loops to prevent "Maximum Call Stack Size Exceeded" errors.
