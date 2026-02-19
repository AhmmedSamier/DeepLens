# Implementation Plan: Improve Search Time

**Branch**: `002-improve-search-time` | **Date**: 2026-02-19 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/002-improve-search-time/spec.md`

---

## Summary

DeepLens currently performs symbol search via an in-memory Struct-of-Arrays (SoA) engine with CamelHumps bitflag pre-screening and Fuzzysort scoring, and text search via a `ripgrep` subprocess. Symbol search already has a three-phase tiered architecture on the extension side (Phase 0 ≈ immediate, Phase 1 ≈ 10ms, Phase 2 ≈ 100ms full fuzzy). This feature targets four areas:

1. **Reduce symbol search hot-loop cost**: audit and tighten pre-screening order; add character-count distance guard; defer activity-score boosting to post-hot-loop.
2. **Surface ripgrep unavailability**: emit a custom LSP notification and disable the text-search UI entry point gracefully.
3. **Expose the ✕ cancel button**: add a dynamic `QuickInputButton` that cancels the in-flight search.
4. **Capture a versioned benchmark baseline** on `main` before any code changes land.

All changes are surgical. No new third-party dependencies. The concurrent-search cancellation contract (FR-006) is already met by the existing `CancellationTokenSource`/`$/cancelRequest` path; only the UI surface (FR-003) needs a small extension.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode); Bun runtime for language server and tooling; Node-compatible for VS Code extension host  
**Primary Dependencies**: `fuzzysort ^3.1.0`, `vscode-languageserver ^9.0.1`, `@vscode/ripgrep ^1.17.0`, `web-tree-sitter ^0.26.3`  
**Storage**: In-memory only (SoA typed arrays + `Map<SearchScope, number[]>` scoped indices); no persistent DB  
**Testing**: `bun test` (language server unit + perf tests); `mocha` + `@vscode/test-electron` (VS Code extension integration tests); `bun run benchmark` (micro-benchmarks in `language-server/benchmarks/`)  
**Target Platform**: VS Code Extension Host (Node.js 20+) + standalone Language Server process (Bun or Node); Windows / macOS / Linux  
**Performance Goals**:
- SC-001: 95th-percentile symbol search < 500ms on 5M-LoC corpus, mid-range laptop (8-core/16GB/SSD)  
- SC-002: 95th-percentile text search < 3s on same corpus/hardware  
- SC-003: ≥50% reduction in first-result latency vs `main` HEAD at branch-cut, measured by `search.bench.ts` and `search_burst.bench.ts`  
- SC-004: Idle CPU/memory overhead increase ≤10% vs pre-feature baseline  
**Constraints**: No new npm dependencies. Changes must not regress existing `bun test` suite. No breaking changes to the LSP API surface exposed to the Visual Studio extension.  
**Scale/Scope**: Targeting repos with up to 5M LoC / ~200k indexed items. Iterative delivery — each task is independently reviewable.

---

## Constitution Check

> Constitution file (`.specify/memory/constitution.md`) has not yet been populated with project-specific gates (it contains the unfilled template). Applying general engineering quality gates instead.

| Gate | Status | Notes |
|------|--------|-------|
| No new external runtime dependencies | ✅ PASS | All changes use existing packages |
| Benchmarks exist for affected paths | ✅ PASS | `search.bench.ts`, `search_burst.bench.ts`, `indexing.bench.ts` already present |
| Cancellation contract maintained | ✅ PASS | `CancellationToken` is threaded through all hot paths; research confirms correct propagation |
| Graceful degradation on ripgrep failure | ✅ PASS (after FR-005 impl) | Currently silent; will surface error notification |
| No blocking operations on Extension Host main thread | ✅ PASS | Search engine runs on language server process; worker threads handle indexing |
| Tests exist (or will be added) for every changed subsystem | ⚠️ REQUIRED | Must add/update unit tests for: hot-loop guard, ripgrep health-check notification, cancel button wiring |

---

## Project Structure

### Documentation (this feature)

```text
specs/002-improve-search-time/
├── plan.md               ← This file
├── research.md           ← Phase 0 output (done)
├── spec.md               ← Feature spec (done, clarified)
├── benchmark-baseline.txt ← Captured on main before any code change (Task 1)
└── tasks.md              ← Phase 2 output (/speckit.tasks command — not yet created)
```

### Source Code (modified files only)

```text
language-server/
├── src/
│   └── core/
│       ├── search-engine.ts          ← Hot-loop optimisations (Tasks 3, 4)
│       ├── ripgrep-service.ts        ← Health-check event emission (Task 5)
│       └── types.ts                  ← Add `deeplens/ripgrepUnavailable` notification type (Task 5)
│   └── server.ts                     ← Handle ripgrepUnavailable, forward notification to client (Task 5)
│   └── benchmarks/
│       └── search.bench.ts           ← Baseline capture / post-optimisation measurement (Tasks 1, 6)

vscode-extension/
├── src/
│   ├── extension.ts                  ← Register ripgrepUnavailable handler (Task 5)
│   └── search-provider.ts            ← Add ✕ cancel button (Task 2)
```

**Structure Decision**: This is a mid-tier optimisation of an existing monorepo (Option 1 — single project with distinct `language-server` and `vscode-extension` sub-projects). Changes are scattered across subsystems but each is small and scoped. No new packages or directories are introduced.

---

## Phases & Decisions

### Phase 0 — Baseline Capture (pre-code)

**Why first**: SC-003 requires a versioned before/after comparison. Without a captured baseline on `main`, the 50% target is immeasurable.

- **Task**: Checkout `main`, run `bun run benchmark` in `language-server/`, save output to `specs/002-improve-search-time/benchmark-baseline.txt`, commit on the feature branch.
- **Verification**: `benchmark-baseline.txt` exists in the repo and contains raw timing numbers for `search.bench.ts` and `search_burst.bench.ts`.

---

### Phase 1 — ✕ Cancel Button in QuickPick (FR-003, FR-004)

**Location**: `vscode-extension/src/search-provider.ts`

**Design**:
- Declare a `static readonly CANCEL_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('stop-circle'), tooltip: 'Cancel search' }`.
- In `handleQueryChange`, after setting `quickPick.busy = true`, append `CANCEL_BUTTON` to `quickPick.buttons` (after the scope filter buttons).
- In the Phase 2 `finally` block, remove `CANCEL_BUTTON` from `quickPick.buttons`.
- In `handleButtonPress` (or `onDidTriggerButton`), detect `CANCEL_BUTTON` by tooltip, call `this.cancelSearch()`, set `quickPick.busy = false`, optionally flash "Search cancelled" as a `quickPick.placeholder` for 800ms then restore.
- **Escape key behaviour**: already handled by `onDidHide` → `cancelSearch()`. No change needed.

**Acceptance gate**: Manual test — start a text search, observe ✕ button appears, click it, spinner stops, no stale results remain.

---

### Phase 2 — ripgrep Health-Check & Graceful Degradation (FR-005)

**Location**: `language-server/src/core/ripgrep-service.ts`, `server.ts`, `vscode-extension/src/extension.ts`

**Design**:

1. **`RipgrepService`**: Add a `private ripgrepHealthy = true` flag and a `onUnavailable: (() => void) | null = null` callback setter (`setUnavailableCallback(cb)`). In `findRgPath()`, if path is empty, call `onUnavailable?.()` synchronously. In `runRgBatch`, on `child.on('error')`, if `ripgrepHealthy` is still `true`: set `ripgrepHealthy = false`, call `onUnavailable?.()` (once; subsequent errors are silent).

2. **`server.ts`**: After constructing `RipgrepService` (inside `setConfig`/`setExtensionPath`), call `ripgrep.setUnavailableCallback(() => connection.sendNotification('deeplens/ripgrepUnavailable', {}))`.

3. **`extension.ts`**: In `activate()`, register `client.onNotification('deeplens/ripgrepUnavailable', () => { vscode.window.showErrorMessage('DeepLens: ripgrep not found — text search disabled. Reinstall the extension to restore it.'); searchProvider.disableTextSearch(); })`.

4. **`SearchProvider.disableTextSearch()`**: Remove the `/txt` (TEXT scope) filter button from `filterButtons` and update `quickPick.buttons` if a QuickPick is open.

**Acceptance gate**: Rename ripgrep binary, open VS Code, trigger a text search → error notification appears, ✕ and text-scope button disappear, symbol search continues normally.

---

### Phase 3 — Symbol Search Hot-Loop Optimisations (FR-002 / SC-001 / SC-003)

**Location**: `language-server/src/core/search-engine.ts`

**Decision A — Character-count distance guard (per `research.md` §2)**:
- Before calling `fuzzysort.single()` per item, check `Math.abs(query.length - preparedName._target.length) > query.length`. If true, skip. This avoids evaluating fuzzy score for strings that cannot possibly score above threshold.
- **Risk**: Low. The guard is conservative (only skips items strictly too long or too short to match). Fuzzysort's own threshold may already cover some of this, but the explicit guard avoids the function call overhead entirely.

**Decision B — Defer activity-score boosting**:
- Currently, `activityScore(item.filePath)` is called in the hot loop for every scored item. Move this call to the post-sort step (after collecting top-K results from the heap). Apply the boost as a final ranking tiebreak pass.
- **Risk**: Low. Activity boosting is for ranking, not filtering. Post-heap application is semantically equivalent for the top-K result set (where K == maxResults, typically 50–150).

**Decision C — Audit bitflag pre-screening order**:
- Confirm `(queryBitflags & itemBitflags) !== queryBitflags` gates occur *before* the fuzzysort call in the hot loop. If the current order already does this, no change is needed. Document the finding.

**Benchmark gate**: After Phase 3, re-run `bun run benchmark`. The `Search 'Component' (Large result set)` and `Short query search 'FCC'` benchmarks must show ≥20% improvement vs baseline. (The 50% SC-003 target is end-to-end; Phase 1 + 2 + 3 contributions are cumulative.)

---

### Phase 4 — Post-Optimisation Verification (SC-001–SC-004)

- Re-run all existing `bun test` and `bun run benchmark` suites.
- Compare benchmark output vs `benchmark-baseline.txt`.
- Document results in `specs/002-improve-search-time/benchmark-results.txt`.
- If SC-003 (50% latency reduction) is not yet met, re-evaluate additional levers from `research.md` (e.g., indexing concurrency tuning).

---

## Complexity Tracking

> No constitution violations identified. No deferred complexity.

| Area | Complexity Note |
|------|----------------|
| Cancel button | Low — reuses existing `QuickInputButton` pattern |
| ripgrep health-check | Low — small callback + LSP notification, no new infra |
| Hot-loop guard | Low — two additional arithmetic comparisons per item |
| Deferred activity boost | Medium — requires re-ordering existing code, must verify ranking semantics unchanged |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Character-distance guard incorrectly skips valid matches (e.g., very short query vs long name) | Low | Medium | Guard uses `> query.length` multiplier — conservative. Unit test with `query.length === 1`. |
| Deferred activity boost changes result ordering in observable ways | Low | Low | Activity scores are small relative to fuzzysort scores. Verify top-5 ordering in benchmark test harness. |
| `onDidTriggerButton` event fires before `quickPick.buttons` is updated | Low | Low | Set `buttons` synchronously in the same microtask as the busy flag. |
| ripgrep path empty on first cold-start before `setExtensionPath` called | Low | Low | `isAvailable()` already guards against empty-string path. |
