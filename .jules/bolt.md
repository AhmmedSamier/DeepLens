## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).
## 2026-04-08 - [Fast Integer ID Tracking]
**Learning:** Using `Set<number>` for tracking integer IDs (such as array indices) in hot loops introduces significant object allocation, hashing overhead, and garbage collection pressure due to boxing. When the indices are bounded and dense (e.g., from 0 to N where N is known), this abstraction is overly expensive.
**Action:** Replace `Set<number>` with a pre-allocated `Uint8Array(maxIndex)`. Tracking presence via array indices (`array[id] = 1`) significantly reduces allocation overhead, provides true O(1) access speed without hashing, and avoids GC pauses in performance-critical paths like search result filtering.
