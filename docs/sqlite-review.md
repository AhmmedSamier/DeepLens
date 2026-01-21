# Architectural Review: SQLite for Index Persistence

## 1. Executive Summary

This review investigates the feasibility and benefits of replacing the current JSON-based `IndexPersistence` mechanism with a SQLite-based solution.

**Recommendation:** **Adopt SQLite** for the persistence layer.

**Key Findings:**
- **Memory Usage:** SQLite reduces the startup memory footprint by approximately **150 MB** for a 100k file repository by eliminating the need to load the entire cache into RAM.
- **Startup Performance:** Incremental startup checks (checking if files are up-to-date) drop from **~860ms** (JSON parse) to **~17ms** (SQLite indexed query).
- **Complexity:** Requires adding a native dependency (`better-sqlite3`), which necessitates careful handling in the VS Code extension build pipeline (Electron headers).

---

## 2. Problem Statement

The current architecture uses a single `index-cache.json` file to store file hashes, mtimes, and extracted symbols.

### Current Workflow:
1.  **Read File:** The entire JSON blob (~46MB for 100k files) is read into a string.
2.  **Parse:** `JSON.parse` blocks the main thread to create a massive object graph.
3.  **Hydrate:** A `Map<string, CacheData>` is populated and kept in memory for the lifecycle of the server.
4.  **Double Allocation:**
    - Copy 1: `IndexPersistence` Map (Persistence cache).
    - Copy 2: `SearchEngine` Items (Active search index).

### Scalability Impact (100k files):
- **Startup Latency:** ~1 second of pure blocking CPU time just to load the cache.
- **Memory Overhead:** ~150 MB of RSS usage strictly for the persistence layer, which is redundant once the `SearchEngine` is populated.

---

## 3. Benchmark Analysis

A synthetic benchmark was conducted simulating a repository with **100,000 files**, each containing 3 symbols.

| Metric | Current (JSON) | Proposed (SQLite) | Improvement |
| :--- | :--- | :--- | :--- |
| **Storage Size** | 46.5 MB | 54.8 MB | -18% (Larger) |
| **Startup (Read+Parse)** | ~860 ms | ~17 ms (Lazy)* | **50x Faster** |
| **Memory Overhead (RSS)** | +149 MB | ~0 MB (Lazy)* | **100% Reduction** |
| **Write Time** | ~920 ms | ~1250 ms | -35% (Slower) |

*\* "Lazy" refers to the optimized workflow where we only query the DB to check specific file hashes during the indexing scan, rather than loading the entire table into memory.*

> **Note on Write Time:** While SQLite write speed is slightly slower in this benchmark, it happens asynchronously or in batches during the indexing phase, so it does not block user interaction as critically as startup time.

---

## 4. Proposed Architecture

### 4.1. Schema Design

We propose a simple single-table schema stored in `index.db`:

```sql
CREATE TABLE files (
    path TEXT PRIMARY KEY,  -- Absolute or relative file path
    mtime INTEGER,          -- Modification timestamp
    hash TEXT,              -- Content hash (SHA-256)
    symbols TEXT            -- JSON blob of extracted symbols
);
```

### 4.2. Workflow Changes

**Old (Current):**
1. `persistence.load()` -> Loads ALL 100k items into RAM.
2. `indexer` iterates files on disk.
3. Checks `persistence.get(path)` (fast RAM lookup).
4. If match, use symbols.

**New (Proposed):**
1. `persistence.open()` -> Opens DB connection (Instant).
2. `indexer` iterates files on disk.
3. Checks `SELECT hash, mtime FROM files WHERE path = ?`.
4. If match, `SELECT symbols` and deserialize only for that file.
5. `IndexPersistence` class **does not** maintain an in-memory Map.

### 4.3. Search Engine Hydration
On cold start (or after cache validation), we need to populate the `SearchEngine`.
- **Approach:** Perform a streaming `SELECT * FROM files`.
- **Benefit:** We can stream rows directly into `SearchEngine` items, allowing the Garbage Collector to clean up the raw DB rows immediately, avoiding the massive object graph spike of `JSON.parse`.

---

## 5. Implementation Strategy

### 5.1. Dependencies
We recommend **`better-sqlite3`**.
- **Pros:** Synchronous API (simplifies migration of existing sync code), extremely fast, mature.
- **Cons:** Native module (C++). Requires compiling against Electron's Node version when bundling for VS Code.

**Alternative:** `sqlite-wasm`.
- **Pros:** Pure JS/WASM, works everywhere without compilation.
- **Cons:** Slower than native, async API might require more refactoring.
- **Verdict:** Given the performance requirements, `better-sqlite3` is preferred if the build pipeline supports it.

### 5.2. Migration Plan
1.  Add `better-sqlite3` to `language-server`.
2.  Implement `SQLitePersistence` class implementing the same interface as `IndexPersistence`.
3.  Update `WorkspaceIndexer` to remove assumptions about synchronous `load()` loading everything into memory.
4.  Add a migration step to delete old `index-cache.json` if `index.db` is created.

---

## 6. Conclusion

Moving to SQLite addresses the critical memory and startup bottlenecks identified in the 100k file scaling tests. The implementation effort is moderate, primarily revolving around build configuration for native modules, but the architectural benefits are significant and permanent.
