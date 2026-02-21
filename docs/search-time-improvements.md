# Search Time Improvement Review

This note captures the most impactful optimizations identified in the current search path.

## 1) Avoid sorting all text-search files on every query

### Current behavior
`performStreamSearch` rebuilds the full file list (`this.items.filter(...)`) and then sorts all files by active/open status for every text query.

### Why it hurts
For large workspaces, O(N log N) sorting is repeated per keystroke, even though active file membership changes relatively infrequently.

### Recommendation
- Keep two cached file arrays:
  - `activeFileItems`
  - `inactiveFileItems`
- Recompute these only when `setActiveFiles()` is called or index contents change.
- At query time, iterate `activeFileItems` first, then `inactiveFileItems` with no per-query sort.

## 2) Add short-lived cache for modified-file scope

### Current behavior
`getIndicesForModifiedFiles()` calls `gitProvider.getModifiedFiles()` each search.

### Why it hurts
`/m` searches may trigger repeated Git status work while users type quickly.

### Recommendation
- Add a small TTL cache (e.g. 300-1000ms) for modified file paths and derived indices.
- Invalidate cache on file save, branch switch, or explicit refresh command.
- This preserves freshness while removing repeated Git work during rapid typing.

## 3) Parallelize provider searches with controlled fan-out

### Current behavior
`executeProviderSearch()` awaits each provider sequentially.

### Why it hurts
Total latency becomes sum of provider latencies. One slow provider delays all results.

### Recommendation
- Run providers concurrently with `Promise.allSettled` and cancellation checks.
- Stream each provider’s results as they arrive (if `onResult` is present).
- Keep an upper bound on in-flight providers to avoid bursts if provider count grows.

## 4) Improve ripgrep throughput across batches

### Current behavior
`RipgrepService.search()` splits files into command-line-sized batches and processes them sequentially.

### Why it hurts
Large file lists on Windows can create many batches; single-threaded batch execution increases wall-clock time.

### Recommendation
- Execute 2-4 batches concurrently.
- Stop launching new batches once `maxResults` is reached.
- Maintain cancellation propagation to kill child processes early.

## 5) Reduce per-query normalization/scoring overhead in unified search

### Current behavior
`performUnifiedSearch()` recalculates scoring against all candidate indices each query, including high-cost fuzzy calls.

### Why it hurts
For frequent typing updates, most candidate sets are highly similar between adjacent queries.

### Recommendation
- Add prefix-query memoization for top-K candidate indices:
  - If query changes from `abc` to `abcd`, start from previous top candidates + bounded backfill.
- Keep this cache tiny (per scope, most recent query chain) to avoid memory growth.
- Reset cache when index mutates.

## 6) Improve first-result latency for text search

### Current behavior
`performStreamSearch()` flushes in batches and chunk loops with fixed concurrency.

### Why it hurts
Users perceive delay when first visible result takes too long in huge workspaces.

### Recommendation
- Adaptive concurrency:
  - Start low for first result (e.g. 4-8), then scale up to configured max after first hit.
- Early flush policy:
  - Flush immediately on first result.
  - Then continue with batched flushes.

## Suggested implementation order

1. **Low risk / quick wins**: #1 and #2.
2. **High impact**: #3 and #4.
3. **Algorithmic improvements**: #5 and #6.

## Measurement plan

- Add timing markers for:
  - query parsing
  - candidate selection
  - provider phase
  - scoring loop
  - text-search engine (`ripgrep` vs stream)
- Record p50/p95 latency by scope (`/all`, `/f`, `/m`, `/txt`) on a representative large repo.
- Ensure no regression in result quality with existing search tests.
