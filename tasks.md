# DeepLens Tasks

## Performance & Scalability Optimizations
- [x] **Streaming Ripgrep Input**: Refactor `RipgrepService.search` to write file paths to the `rg` process `stdin` iteratively.
- [x] **Worker Initialization & Warm-up**: Optimize the indexing worker pool to reuse workers or warm them up.
- [x] **Scoring Hot-path Refinement**: Inline critical scoring logic in `SearchEngine.calculateUnifiedScore` and minimize object destructuring/allocations within the `performUnifiedSearch` loop.
- [ ] **SQLite Migration**: Transition `IndexPersistence` from NDJSON to SQLite to allow for lazy-loading of file metadata (hashes/mtimes), reducing the baseline memory footprint for massive repositories.

## Completed
- [x] **Struct of Arrays**: Refactored `SearchEngine` to use parallel arrays for searchable items, significantly reducing object overhead.
- [x] **Async Indexing**: Made `WorkspaceIndexer` cache checks and hashing asynchronous to prevent main-thread blocking.
- [x] **Streaming Persistence**: Implemented NDJSON streaming in `IndexPersistence` to remove memory spikes during cache load/save.
- [x] **Piped Ripgrep Input**: Initial implementation of `--files-from -` to avoid temporary file creation on disk.