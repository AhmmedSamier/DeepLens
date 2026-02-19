# Research: Improve Search Time

**Branch**: `002-improve-search-time` | **Date**: 2026-02-19

---

## 1. Current Architecture Baseline

### Decision: Document current hot-path before optimising
- **What exists**: Three-phase search on the extension side (Phase 0 = instant burst, Phase 1 = 10ms burst, Phase 2 = 100ms full fuzzy). Language server has `SearchEngine` with Struct-of-Arrays (SoA), Fuzzysort, CamelHumps bitflags, and a scoped-index map for pre-filtered subsets. Worker-thread pool (up to 8 workers, `cpuCount - 1`) for symbol extraction. Ripgrep subprocess for text search.
- **Rationale**: Understanding the existing bottlenecks prevents duplicate work and frames each optimisation decision precisely.
- **Alternatives considered**: None — required baseline for SC-003 50% target.

---

## 2. Symbol Search Bottlenecks (FR-002 / SC-001)

### Decision: Target 3 sub-areas — hot-loop early-exit, scoped index pre-filtering, and fuzzysort threshold tuning

**Findings from code analysis:**

1. **`performUnifiedSearch` hot loop** (`search-engine.ts`): The main search loop iterates over all items (or a scope-filtered subset) and computes bitflag screening, CamelHumps matching, and/or fuzzysort scoring per item. For EVERYTHING scope with 200k+ items, worst-case is a full linear sweep. CamelHumps query bitflags already allow O(1) pre-screening (`(queryBitflags & itemBitflags) !== queryBitflags → skip`), but this screening must fire before the more expensive fuzzysort call.
2. **`scopedIndices` pre-filtering**: Already implemented. Scoped searches (TYPES, FILES, SYMBOLS…) only iterate scope-relevant items. EVERYTHING scope iterates all. **No structural change needed here** — the optimisation focus is on per-item cost reduction.
3. **Fuzzysort threshold**: The current threshold allows many items that barely match. Tightening the threshold, or adding a maximum character-distance guard before calling fuzzysort, reduces the number of full fuzzy evaluations.
4. **Score computation overhead**: `ITEM_TYPE_BOOSTS` multiply and `activityScore` callback are done per result. These can be deferred until the top-K heap is assembled.

- **Decision**: (a) Verify bitflag pre-screening fires before fuzzysort call in the hot loop (code audit). (b) Add a character-count distance guard: if `Math.abs(query.length - item.name.length) > query.length` skip early. (c) Defer `activityScore` to post-heap assembly.
- **Rationale**: Low-risk, zero-dependency, measurable via existing `search.bench.ts`.
- **Alternatives considered**: WASM SIMD search (high complexity, Bun compatibility risk), trie index (large memory overhead, complex incremental update).

---

## 3. Text Search (ripgrep) Bottlenecks (FR-002 / SC-002)

### Decision: Add ripgrep binary health-check on startup; batch processing already exists

**Findings:**
- `RipgrepService.search()` already batches files to respect Windows 20k cmd-line limit and respects `CancellationToken`.
- `RipgrepService.findRgPath()` returns `''` silently if binary is missing. The `isAvailable()` check exists but no error is surfaced upstream to the user — this is the gap FR-005 addresses.
- Current `search-engine.ts` calls `this.ripgrep` only inside `performTextSearch`. If `this.ripgrep` is `undefined` (i.e., `setExtensionPath` not called) or `!this.ripgrep.isAvailable()`, control falls to a pure-TS fallback text scan which is O(N×fileSize), slow.
- The pure-TS text scan reads files synchronously inside the hot loop and has no cancellation.

- **Decision for ripgrep availability**: Add a `ripgrepHealthy: boolean` flag (default `true`). On first `isAvailable() === false` or any spawn `error` event, set flag to `false` and emit a `onRipgrepUnavailable` event. Server listens and sends `deeplens/ripgrepUnavailable` notification to extension. Extension shows `vscode.window.showErrorMessage` and calls `searchEngine.disableTextSearch()`.
- **Decision for pure-TS fallback cancellation**: The existing `StreamTextScanContext`-based fallback already checks `token?.isCancellationRequested` per file. No changes needed there for cancellation correctness.
- **Rationale**: Minimal surface area change; isolates failure cleanly.
- **Alternatives considered**: Retry loop on spawn error (complexity without clear benefit — if binary is missing, retries will fail immediately).

---

## 4. Concurrent Search Cancellation (FR-003 / FR-006)

### Decision: Already partially implemented; gap is the "cancel previous on new query" flow in the server handler

**Findings:**
- Extension side (`search-provider.ts`): `cancelSearch()` → `searchCts.cancel()` + new `CancellationTokenSource` is called at the start of `performSearch()` (line ~1118). So the extension already cancels the prior CTS before issuing a new request. ✅
- Server side (`server.ts`): `DeepLensSearchRequest` and `BurstSearchRequest` handlers receive a `CancellationToken` from the LSP framework. The `searchEngine.search()` and `searchEngine.burstSearch()` methods propagate this token into the hot loop and ripgrep subprocess.
- **Gap**: The server does NOT maintain a reference to the in-flight `AbortController` / ripgrep child process across requests. Each request is independent. Because the LSP framework sends `$/cancelRequest` to abort the server-side coroutine, and the `CancellationToken` is checked at yield points in the hot loop, cancellation does propagate — but only lazily (at yield points).
- For text search (ripgrep), `child.kill()` is called immediately when `token.onCancellationRequested` fires → correct.
- **Conclusion**: The concurrent cancellation contract (FR-006) is already largely met. The remaining work is UI (FR-003): surfacing the ✕ button beside the busy spinner.

- **Decision**: No server-side architectural change. Extension-side: expose a cancel button in the QuickPick title area (a `vscode.QuickInputButton` added to `quickPick.buttons`) that calls `cancelSearch()` and then hides with a "Cancelled" flash.
- **Rationale**: Minimal delta; reuses `cancelSearch()` (already tested path).

---

## 5. Indexing Speed (FR-001 / SC-003)

### Decision: Identify if worker warmup + git-first listing is covering first-index latency

**Findings:**
- `WorkspaceIndexer.warmup()` is called immediately after construction (server.ts line ~195). Workers boot before `onInitialized` fires — good.
- `indexFiles()` uses `git ls-files --cached --others --exclude-standard` as a "turbo path". This is order-of-magnitude faster than `env.findFiles()` glob walk for large repos.
- Symbol extraction uses a worker thread pool (up to 8 workers) + a concurrent `scanWorkspaceSymbols` pass (VS Code workspace symbol provider) — both run in `Promise.all`.
- **Potential gain**: The `processFileList` concurrency is capped at 50 (`p-limit`). For repos with many small files, this is the bottleneck. The `batchSize` passed to workers is 100 files/batch. These values were chosen empirically; revisiting them for a 5M-LoC repo could help.
- **Decision**: No structural refactor needed. The incremental worker-pool architecture is sound. Tuning: add `p-limit` concurrency as a configurable setting (`deeplens.indexConcurrency`, default 50) and document the tuning recommendation for large repos. This is a low-risk, high-value lever.

---

## 6. Benchmark Baseline Capture (SC-003)

### Decision: Record baseline timing from `main` branch before any changes land

- **What**: Run `bun run benchmark` and `bun run benchmark:memory` on `main`, save output to `specs/002-improve-search-time/benchmark-baseline.txt`. This becomes the SC-003 reference point.
- **Who**: Dev runs this manually before merging any implementation task. The result file is committed to the feature branch alongside `plan.md`.
- **Rationale**: SC-003 requires a concrete 50% before/after comparison. Without a captured baseline, the criterion is untestable.
- **Alternatives considered**: CI-automated baseline snapshot (deferred — requires a dedicated benchmark CI job outside current scope).

---

## 7. Progress Indicator & Cancel Button (FR-003 / FR-004)

### Decision: Extend `quickPick.buttons` array with a ✕ cancel button when a search is in-flight

**Findings from `search-provider.ts`:**
- `quickPick.busy = true` is set when a search starts and cleared in the `finally` of Phase 2's timeout. The busy spinner is already shown. ✅
- `quickPick.buttons` are currently filter-scope buttons only. VS Code's `QuickPick` supports dynamic button updates at any time.
- `quickPick.onDidTriggerButton` already handles button presses.

- **Decision**: When `quickPick.busy` transitions to `true`, append a `$(stop-circle)` cancel button to `quickPick.buttons`. When the search completes or is cancelled, remove it. Map this button in `handleButtonPress` to call `cancelSearch()` and set `quickPick.busy = false`.
- **Rationale**: Canonical VS Code pattern. No new APIs needed.
- **Alternatives considered**: Status bar cancel command (less discoverable, inconsistent with VS Code UX).

---

## 8. ripgrep Unavailability Surface (FR-005)

### Decision: Emit a custom LSP notification `deeplens/ripgrepUnavailable`; extension shows error message once per session

- **Server**: In `SearchEngine.setExtensionPath()`, after constructing `RipgrepService`, if `!this.ripgrep.isAvailable()` emit `deeplens/ripgrepUnavailable` notification immediately. Also emit on first `child.on('error')` in `runRgBatch`.
- **Extension** (`extension.ts`): Register a handler for `deeplens/ripgrepUnavailable` that calls `vscode.window.showErrorMessage('DeepLens: ripgrep binary not found — text search is disabled. Reinstall the extension to restore text search.')`. Disable the `/txt` scope button in the search provider.
- **Rationale**: One-time notification per session; informative but non-fatal.
