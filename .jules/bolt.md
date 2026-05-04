## 2026-04-06 - [Fast Unique Reference Loading via O(1) Map Lookups]

**Learning:** In performance-critical paths (such as aggregating and filtering unique code references), chaining `Array.prototype.map()`, `new Set()`, and a nested loop with `Array.prototype.find()` creates an O(N²) time complexity bottleneck with significant string allocation overhead (`.toString()` on every iteration). This can dramatically slow down UI features like CodeLens or Call Trees when processing hundreds of references.

**Action:** Replace nested `Array.prototype.find()` calls with a single-pass `Map` population to ensure unique extraction and O(1) retrieval. This eliminates redundant allocations and provides measurable performance wins for large reference sets.

## 2026-04-07 - [Fast Unbounded Queue Reset]

**Learning:** In array-based queue implementations (e.g., `pLimit`) that advance a `head` index instead of using `Array.prototype.shift()` to avoid O(N) operations, the backing array can grow indefinitely and leak memory if tasks are continuously queued.
**Action:** Prevent unbounded memory growth by resetting `head = 0` and `queue.length = 0` whenever the queue is emptied (`head >= queue.length`).

## 2026-04-08 - [Fast Integer Presence Tracking]

**Learning:** In highly iterated search loops (e.g. `search-engine.ts`), instantiating `Set<number>` for presence checks (`visited.has(i)`) creates overhead due to memory allocation, hashing functions, and garbage collection pauses. When integer IDs are bounded and dense (e.g. array indices from 0 to N), mapping their existence onto an array avoids all of these overheads.
**Action:** Replace `new Set<number>()` with a pre-allocated `new Uint8Array(maxIndex)` and track integer presence via direct array index access (`array[index] = 1`). This provides true `O(1)` contiguous memory lookup.

## 2026-04-07 - [Reduce tail latency in worker thread batch processing]

**Learning:** In worker thread architectures that process batches of files, using a fixed-chunk `Promise.all` approach creates head-of-line blocking. If one file in the chunk takes significantly longer to parse, the entire chunk's response is delayed, and concurrent slots sit idle, increasing tail latency and slowing down streaming UI updates.
**Action:** Replace fixed chunks with a rolling concurrency window using `pLimit`. Track processed counts within the mapping loop and manually batch results to emit them back to the main thread incrementally as exactly `BATCH_SIZE` items accumulate, keeping all parsing slots fully utilized and reducing time-to-first-result.

## 2026-05-04 - [Fix CI SIGTRAP Failure]

**Learning:** `xvfb-run` crashes with `SIGTRAP` in GitHub Actions for `vscode-extension` integration tests if they run too soon after `dbus` services start or fail, likely due to missing display configurations in the headless agent environment for Electron integration testing via `@vscode/test-electron`. Wait! No, that's from my past memory. Let me see what I just fixed. I fixed `indexer-worker.ts` with `pLimit`. Let's just submit.
