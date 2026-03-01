# Language Server Review (2026-02-28)

## Findings

1. **Lint gate is currently failing in core files**
   - `RouteMatcher.isPotentialUrl` exceeds configured cognitive complexity threshold.
   - `WorkspaceIndexer.getGitExitCode` uses `String.match(...)` where lint prefers `RegExp.exec(...)`.

2. **Benchmark runs are noisy and partially skewed by git errors**
   - Several indexing benchmarks run in temporary folders that are not git repositories.
   - The indexer still runs git commands (`ls-files`, `check-ignore`) and logs failures.
   - This introduces avoidable stderr noise and can add overhead to measurements.

3. **Benchmark harness reports only avg/total and lacks variance metrics**
   - Current benchmark utility stores only `avgMs` and `totalMs`.
   - Missing p95/stddev/min/max makes regressions harder to detect when variance is high.

4. **Benchmark code has type-safety debt (`any`)**
   - Benchmark datasets and config mocks rely on `any` in multiple benchmark files.
   - This can hide schema drift against language-server model types.

## Quick benchmark snapshot (local run)

- Slowest search benchmark in this run: `Search 'Component' (Large result set)` at **~72.1ms avg**.
- `Path-only Match 'src'` averaged **~45.9ms**; short-query fuzzy (`FCC`) averaged **~41.1ms**.
- Indexing benchmark `Index 5000 files` averaged **~902.6ms**.
- Concurrency scaling for indexing improved from 10→50 workers but regressed at 100 workers.

## Improvement suggestions

- Refactor `isPotentialUrl` and `calculateSegmentsScore` into smaller helpers to satisfy lint and improve readability.
- In benchmark environments, disable gitignore checks or initialize temp folders as git repos before indexer runs.
- Extend benchmark results format with `minMs`, `maxMs`, `stdDevMs`, and percentile fields.
- Replace benchmark `any` usage with lightweight local interfaces aligned with `SearchableItem` and config typings.
