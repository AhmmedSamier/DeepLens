## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.
## 2026-04-07 - [Fast Unbounded Queue Reset]
**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).
## 2026-04-12 - [Avoid Spread Syntax for Unbounded Array Push]

**Learning:** When pushing elements from potentially large or unbounded arrays (e.g., aggregated results from parsing many files in a background worker thread), using the array spread operator (`currentBatchItems.push(...items)`) creates a massive risk for stack overflow (`Maximum Call Stack Size Exceeded`). This occurs because JavaScript engines place a hard limit on the number of arguments a function can accept, and the spread syntax expands the array elements into function arguments for `.push()`.

**Action:** Replace `array.push(...items)` with a manual `for` loop (`for(let i=0; i<items.length; i++) array.push(items[i])`) when accumulating dynamically sized, potentially large array results.
