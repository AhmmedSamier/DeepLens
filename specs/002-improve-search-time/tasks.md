# Tasks: Improve Search Time

**Input**: Design documents from `/specs/002-improve-search-time/`  
**Prerequisites**: `plan.md` ✅ | `spec.md` ✅ | `research.md` ✅  
**Tests**: Not requested — no test tasks generated.  
**Organization**: Tasks grouped by user story (US1 = Fast Symbol Search, US2 = Fast Text Search) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: User story label (US1 = Fast Symbol Search, US2 = Fast Text Search)
- Exact file paths included in every description

---

## Phase 1: Setup — Benchmark Baseline Capture

**Purpose**: Capture a versioned benchmark baseline on `main` before any code changes land. Required by SC-003 (≥50% first-result latency reduction) — without this, the success criterion is unmeasurable.

**⚠️ CRITICAL**: Run this on the `main` branch (or stash/commit all WIP) before proceeding to any implementation phase.

- [ ] T001 Checkout or stash WIP so `main` branch is clean; run `bun run benchmark` inside `language-server/` and redirect full output to `specs/002-improve-search-time/benchmark-baseline.txt` (captures `search.bench.ts` and `search_burst.bench.ts` timings)
- [ ] T002 Commit `specs/002-improve-search-time/benchmark-baseline.txt` to the feature branch (`002-improve-search-time`) with message `chore: capture benchmark baseline before search-time optimisations`

**Checkpoint**: `benchmark-baseline.txt` exists in the repo, contains raw timing numbers for `Search 'Component'` and `CamelHumps Search 'FCC'` benchmarks, and is committed.

---

## Phase 2: Foundational — LSP Notification Type

**Purpose**: Define the shared `deeplens/ripgrepUnavailable` notification type that both US1 and US2 code paths depend on. Must be complete before US2 implementation begins.

**⚠️ CRITICAL**: This phase is a blocking prerequisite for Phase 4 (US2).

- [ ] T003 Add the `deeplens/ripgrepUnavailable` custom LSP notification type definition to `language-server/src/core/types.ts` — export a `RipgrepUnavailableNotification` interface (params: `{}`) and register the method string `'deeplens/ripgrepUnavailable'` as a typed constant

**Checkpoint**: `types.ts` exports the notification type; `bun run build` (or `bun run compile` from `vscode-extension/`) succeeds with no TypeScript errors.

---

## Phase 3: User Story 1 — Fast Symbol Search (Priority: P1) 🎯 MVP

**Goal**: Reduce per-item cost in the `performUnifiedSearch` hot loop so that 95th-percentile symbol search completes in <500ms on a 5M-LoC corpus (SC-001) and first-result latency drops ≥50% vs baseline (SC-003 partial contribution).

**Independent Test**: Run `bun run benchmark` in `language-server/`. The `Search 'Component' (Large result set)` and `CamelHumps Search 'FCC'` benchmarks must show ≥20% improvement vs `benchmark-baseline.txt`. Symbol search in a real VS Code window returns results for a known symbol in <500ms.

### Implementation for User Story 1

- [ ] T004 [US1] Audit `language-server/src/core/search-engine.ts` hot loop in `performUnifiedSearch`: locate the exact line order of (a) CamelHumps bitflag pre-screening `(queryBitflags & itemBitflags) !== queryBitflags`, (b) character-count guard, and (c) `fuzzysort.single()` call — document the current order in a code comment. If bitflag screening already fires before `fuzzysort`, confirm and comment; otherwise reorder so it fires first.
- [ ] T005 [US1] Add character-count distance guard in the hot loop of `language-server/src/core/search-engine.ts`, immediately after the bitflag pre-screening check and before the `fuzzysort.single()` call: `if (Math.abs(query.length - preparedName._target.length) > query.length) continue;` — add a JSDoc comment explaining the guard and citing `research.md §2`.
- [ ] T006 [US1] Defer `activityScore` boosting in `language-server/src/core/search-engine.ts`: remove the `activityScore(item.filePath)` call from inside the hot loop and instead apply it as a post-sort tiebreak pass after the top-K heap is assembled. Ensure the final ranked result ordering is semantically equivalent to the pre-change behaviour (activityScore is a small relative adjustment to ranking, not filtering).
- [ ] T007 [US1] Re-run `bun run benchmark` in `language-server/` and capture output to `specs/002-improve-search-time/benchmark-results-us1.txt`; compare against `benchmark-baseline.txt` and confirm ≥20% improvement on `Search 'Component'` and `CamelHumps Search 'FCC'` benchmarks.

**Checkpoint**: After T007, User Story 1 is independently verifiable. Symbol search benchmarks show measurable improvement. All existing `bun test` tests in `language-server/` still pass.

---

## Phase 4: User Story 2 — Fast Text Search & Graceful Degradation (Priority: P2)

**Goal**: Expose a visible ✕ cancel button in the QuickPick during in-flight searches (FR-003/FR-004), and surface ripgrep unavailability via a VS Code error notification + disable the text-search UI entry point (FR-005), while leaving symbol search fully operational.

**Independent Test**: (a) Start a text search — the ✕ cancel button appears beside the busy spinner; clicking it stops the search, clears the spinner, discards partial results, and briefly shows "Search cancelled" in the placeholder. (b) Rename/remove the ripgrep binary from the extension bundle; restart the extension host; trigger a text search — an error notification appears, the `/txt` scope filter button disappears, and a symbol search still works.

### Implementation for User Story 2

- [ ] T008 [P] [US2] Add cancel button constant and button injection to `vscode-extension/src/search-provider.ts`: declare `static readonly CANCEL_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('stop-circle'), tooltip: 'Cancel search' }`. In `handleQueryChange`, after setting `quickPick.busy = true`, append `CANCEL_BUTTON` to `quickPick.buttons` (preserve existing scope-filter buttons). In the Phase 2 `finally` block, remove `CANCEL_BUTTON` from `quickPick.buttons` and set `quickPick.busy = false`.
- [ ] T009 [US2] Wire cancel button press to `cancelSearch()` in `vscode-extension/src/search-provider.ts`: in `handleButtonPress` (or `onDidTriggerButton` handler), detect the button by checking `button === SearchProvider.CANCEL_BUTTON` (or compare `tooltip`), then call `this.cancelSearch()`, set `quickPick.busy = false`, flash "Search cancelled" to `quickPick.placeholder` for 800ms and then restore the original placeholder. (Depends on T008)
- [ ] T010 [P] [US2] Implement ripgrep health-check flag and unavailability callback in `language-server/src/core/ripgrep-service.ts`: add `private ripgrepHealthy = true` and `private onUnavailableCallback: (() => void) | null = null`. Add public method `setUnavailableCallback(cb: () => void): void`. In `findRgPath()`, if the resolved path is empty, call `this.onUnavailableCallback?.()`. In `runRgBatch`, on `child.on('error', ...)`, if `this.ripgrepHealthy` is `true`: set `this.ripgrepHealthy = false` and call `this.onUnavailableCallback?.()` (emit once; subsequent errors are silent).
- [ ] T011 [US2] Wire `RipgrepService.setUnavailableCallback` in `language-server/src/server.ts`: after constructing (or obtaining) the `RipgrepService` instance inside `setConfig`/`setExtensionPath`, call `ripgrep.setUnavailableCallback(() => connection.sendNotification('deeplens/ripgrepUnavailable', {}))` using the typed constant from T003. (Depends on T003 and T010)
- [ ] T012 [US2] Implement `SearchProvider.disableTextSearch()` in `vscode-extension/src/search-provider.ts`: remove the TEXT scope (`'/txt'`) filter button from `this.filterButtons`; if a QuickPick is currently open, update `quickPick.buttons` synchronously to reflect the removal. (Depends on T008/T009 for the button management infrastructure)
- [ ] T013 [US2] Register `deeplens/ripgrepUnavailable` notification handler in `vscode-extension/src/extension.ts`: inside `activate()`, add `client.onNotification('deeplens/ripgrepUnavailable', () => { vscode.window.showErrorMessage('DeepLens: ripgrep binary not found — text search is disabled. Reinstall the extension to restore text search.'); searchProvider.disableTextSearch(); })`. (Depends on T003, T012)

**Checkpoint**: After T013, User Story 2 is independently verifiable. Both acceptance scenarios pass. All existing `bun test` and VS Code extension tests still pass.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, benchmark measurement, and documentation to confirm all success criteria are met.

- [ ] T014 [P] Run all existing `bun test` unit + perf tests in `language-server/` (`bun run test`) and confirm zero regressions
- [ ] T015 [P] Run the full VS Code extension test suite in `vscode-extension/` (`bun run test`) and confirm zero regressions
- [ ] T016 Re-run `bun run benchmark` in `language-server/` after all code changes; save full output to `specs/002-improve-search-time/benchmark-results.txt`; document comparison vs `benchmark-baseline.txt` in `specs/002-improve-search-time/benchmark-results.txt` (check SC-001, SC-003 ≥50% first-result latency target, SC-004 idle overhead ≤10% increase). (Depends on T014)
- [ ] T017 If SC-003 (≥50% latency reduction) is not met after T016, evaluate additional levers from `research.md §5` (indexing concurrency tuning: expose `deeplens.indexConcurrency` setting in `language-server/src/core/workspace-indexer.ts` and register it in `vscode-extension/src/extension.ts` `contributes.configuration`).
- [ ] T018 [P] Update `specs/002-improve-search-time/plan.md` Phase 4 section with final benchmark results and notes on SC-001–SC-004 outcomes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup/Baseline)**: No dependencies — run on `main` HEAD before any code change; captures the SC-003 reference point
- **Phase 2 (Foundational)**: No code dependencies; should be done before Phase 4 starts
- **Phase 3 (US1 — Symbol Search)**: No dependency on Phase 2; can start immediately after Phase 1 baseline is captured
- **Phase 4 (US2 — Text Search/Cancel/ripgrep)**: Depends on Phase 2 (T003 must exist before T011 and T013)
- **Phase 5 (Polish)**: Depends on all implementation phases (Phase 3 + Phase 4) being complete

### User Story Dependencies

- **User Story 1 (P1)**: Independent — only touches `language-server/src/core/search-engine.ts`; can start immediately after baseline capture
- **User Story 2 (P2)**: Depends on the T003 notification type (Phase 2). Otherwise independent of US1. T008/T010 are parallelizable.

### Within Each User Story

- **US1**: T004 → T005 → T006 (sequential; each modifies the same hot loop; T007 is final measurement)
- **US2**: T008 and T010 can start in parallel (different files: `search-provider.ts` vs `ripgrep-service.ts`). T009 depends on T008. T011 depends on T003+T010. T012 depends on T008. T013 depends on T003+T012.

### Parallel Opportunities

- T008 and T010 can be worked simultaneously (different subsystems)
- T014 and T015 can run in parallel (different test suites)
- Once Phase 2 is done, Phase 3 (US1) and Phase 4 (US2) can be worked by different developers simultaneously

---

## Parallel Example: User Story 2

```text
# These two tasks can start in parallel (different files):
T008 — Add cancel button to vscode-extension/src/search-provider.ts
T010 — Add ripgrep health-check to language-server/src/core/ripgrep-service.ts

# Then in sequence:
T009 — Wire cancel button press (depends on T008)
T011 — Wire setUnavailableCallback in server.ts (depends on T003 + T010)
T012 — Implement disableTextSearch() (depends on T008/T009)
T013 — Register notification handler in extension.ts (depends on T003 + T012)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (baseline capture) — critical for SC-003 proof
2. Complete Phase 2 (notification type) — quick, unblocks US2 later
3. Complete Phase 3 (US1: symbol search hot-loop) — T004 → T005 → T006 → T007
4. **STOP and VALIDATE**: Run `bun test` + `bun run benchmark`; confirm ≥20% improvement on symbol search benchmarks
5. US1 delivers immediate value: faster code navigation, measurable perf gain

### Incremental Delivery

1. Phase 1 → Phase 2 → Phase 3 (US1) → validate → ship
2. Phase 4 (US2) → validate → ship
3. Phase 5 (Polish + final benchmark) → document outcomes

### Parallel Team Strategy

With two developers:
- **Developer A**: Phase 3 (US1 — `search-engine.ts` hot-loop)
- **Developer B**: Phase 4 T008 + T010 simultaneously, then T009, T011, T012, T013

---

## Notes

- [P] tasks can run in parallel — they modify different files with no shared incomplete dependencies
- [Story] label maps every task to a specific user story for traceability and independent delivery
- No test tasks are included (tests were not requested in spec.md)
- Commit after each task or logical group; use Conventional Commits (e.g., `perf(ext): add cancel button`, `fix(server): emit ripgrepUnavailable notification`)
- `benchmark-baseline.txt` MUST be captured on `main` before any implementation task — this is the SC-003 reference
- Stop at Phase 3 checkpoint to validate US1 independently before proceeding to US2
