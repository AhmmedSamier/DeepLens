## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.

## 2026-04-07 - [Fast Unbounded Queue Reset]

**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-08 - [Fast Dense Integer Set Tracking]

**Learning:** When keeping track of seen integer IDs that are dense and bounded (e.g. from 0 to N), using `new Set<number>()` incurs heavy allocation and insertion overhead compared to a fixed-size byte array.
**Action:** Replace `Set<number>` with `new Uint8Array(maxIndex)` and use `array[id] = 1` to track presence, which is ~15x faster and avoids garbage collection pauses in hot paths. (Benchmark context: `N=100,000` IDs, `bun` version 1.2.14, Linux x86_64, Intel Xeon 2.30GHz, 4 cores, 8GB RAM, averaged over 100 iterations comparing `Set<number>` addition vs `new Uint8Array(maxIndex)` indexed assignment `array[id] = 1`).
