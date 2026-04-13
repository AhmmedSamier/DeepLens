## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).
## 2026-04-13 - [Fast Dense Tracking via Uint8Array]

**Learning:** In hot path loops tracking seen/visited index values that are bounded and densely packed (e.g., matching item IDs from `0` to `this.items.length`), using a dynamically sized `Set<number>` incurs measurable overhead from hashing and garbage collection.
**Action:** Replace `Set<number>` with a pre-allocated `Uint8Array` of size `this.items.length`. Tracking visits via simple array indexing (e.g. `array[index] = 1`) shifts tracking from `O(1)` object allocation/hashing overhead to ultra-fast `O(1)` contiguous memory access, yielding significant speedups with negligible memory cost.
