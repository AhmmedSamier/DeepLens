# Language Server + VS Code Extension Review

Date: 2026-02-12

## Scope
- `language-server/`
- `vscode-extension/`

## Findings

### 1) Ripgrep binary resolution misses macOS ARM64 (functional bug)
**Severity:** High

The language server downloads a dedicated `rg-darwin-arm64` binary during packaging, but runtime lookup on macOS only checks for `rg-darwin-x64`, `rg-darwin`, and `rg`. On Apple Silicon systems without a fallback `rg` in `PATH`, text search can silently become unavailable.

- Downloaded artifact name: `rg-darwin-arm64` in build script.
- Runtime lookup list on `darwin` does not include `rg-darwin-arm64`.

**Suggested fix:**
1. Add `rg-darwin-arm64` to `binPatterns` for `process.platform === 'darwin'`.
2. Add a unit test in `ripgrep-service.test.ts` for Apple Silicon binary selection.

---

### 2) Git modified-scope collection can fail silently (diagnostics gap)
**Severity:** Medium

`GitProvider.getModifiedFiles()` suppresses all errors for each workspace root. If `git` fails for legitimate reasons (PATH issue, temporary repo lock/index corruption), MODIFIED scope quality degrades to empty/noisy results with no surfaced signal.

**Suggested fix:**
1. Log once per root at debug/warn level with error type and exit code.
2. Distinguish expected non-git-root failures from unexpected execution failures.
3. Add telemetry/debug counters for skipped roots (if telemetry exists in project scope).

---

### 3) Language server lint baseline currently fails (quality gate)
**Severity:** Medium

`language-server` lint currently fails with 13 errors across core files and tests. That blocks a strict CI quality gate and hides newly introduced regressions among existing violations.

Representative categories from current run:
- ignored exceptions / unused vars
- updated loop-counter pattern
- high cognitive complexity
- explicit `any`
- commented-out code

**Suggested fix:**
1. Triage existing lint errors into a short backlog (quick wins vs refactor-heavy).
2. Resolve quick wins first (unused imports/vars, commented code).
3. Refactor highest-complexity functions incrementally behind tests.
4. Re-enable/keep lint as required CI gate once baseline is green.

---

### 4) Extension integration tests are not hermetic on minimal Linux environments
**Severity:** Medium

`vscode-extension` integration tests failed in this environment because Electron requires OS shared libraries (`libatk-1.0.so.0`) not present in slim containers. This makes test outcomes environment-dependent and can produce false negatives in CI images that are not desktop-ready.

**Suggested fix:**
1. Document required Linux packages for integration tests.
2. In CI, run on an image that includes Electron dependencies (or install them in workflow).
3. Optionally split smoke/unit checks from Electron integration tests for faster deterministic feedback.

---

## Proposed execution plan

### Phase 1 — Functional fixes (high confidence, low blast radius)
1. Fix darwin ARM64 binary detection in `RipgrepService`.
2. Add/adjust tests around ripgrep binary selection and availability checks.

### Phase 2 — Observability and resilience
1. Improve `GitProvider` error handling with lightweight logging.
2. Add tests that emulate non-git roots and git execution failures.

### Phase 3 — Quality baseline
1. Burn down existing `language-server` lint violations.
2. Keep incremental PRs small and test-backed to avoid behavior drift.

### Phase 4 — CI and test environment hardening
1. Update CI docs/workflow for Electron system dependencies.
2. Optionally separate pure TS/unit checks from integration tests.

