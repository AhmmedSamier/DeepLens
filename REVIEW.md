# DeepLens Codebase Review

## Executive Summary
DeepLens is a robust "Search Everywhere" extension utilizing `web-tree-sitter` for high-performance parsing and `fuzzysort` for search capabilities. It employs a client-server architecture using the Language Server Protocol (LSP), which is a solid foundation for performance and scalability. However, several advertised features are currently missing or incomplete, and there are opportunities for architectural enhancements.

## Feature Gaps

### 1. Text Search Not Implemented
- **Status:** The configuration `deeplens.enableTextSearch` exists in `package.json` and `Config` class.
- **Finding:** The `SearchEngine` only searches indexed symbols and filenames. There is no logic to scan file content for text matches.
- **Impact:** Users expecting `grep`-like functionality (finding string literals or comments) will find no results.

### 2. Missing "Recent History"
- **Status:** Standard feature in modern IDEs (IntelliJ, VS Code Quick Open).
- **Finding:** The search dialog opens with an empty list. It does not display recently opened files or previously selected symbols.
- **Impact:** Reduces developer velocity as they often toggle between a small working set of files.

### 3. Endpoint Search Limitations
- **Status:** "Specialized Endpoint Search" is a highlighted feature.
- **Finding:** Implementation is hardcoded for **C# / ASP.NET** only (using `[HttpGet]`, `MapGet`, etc.).
- **Impact:** No support for popular web frameworks in other supported languages, such as:
  - **TypeScript/JavaScript:** Express.js, NestJS, Fastify.
  - **Python:** Flask, Django, FastAPI.
  - **Go:** Gin, Echo.

## Architectural Observations

### 1. In-Memory Indexing
- **Observation:** The `SearchEngine` maintains the entire index (`items: SearchableItem[]`) in memory.
- **Risk:** For very large monorepos (e.g., 100k+ files), this could lead to high memory consumption in the LSP process.
- **Recommendation:** Consider a hybrid approach or an on-disk embedded database (like SQLite or LevelDB) for the index if memory usage becomes a bottleneck.

### 2. Activity Tracking
- **Observation:** `ActivityTracker` exists but appears to be primarily used for boosting search scores rather than populating a "Recent" list view.
- **Recommendation:** Repurpose `ActivityTracker` to provide a time-ordered list of recent items for the initial search state.

## Recommendations for Next Steps

1.  **Implement Recent History:** High value, low effort. enhance `ActivityTracker` to return sorted recent items and populate the empty search state.
2.  **Expand Endpoint Support:** Add `tree-sitter` queries for Express.js (TS) and Flask/FastAPI (Python).
3.  **Implement Text Search:** Integrate `ripgrep` or a similar tool for text content searching, as strictly in-memory searching of all file content is not feasible.
