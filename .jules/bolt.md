## 2026-03-07 - [Optimize Chained String Replacements]
**Learning:** In hot paths like `CommandIndexer.commandIdToTitle`, chaining multiple `.replaceAll` operations sequentially with different regexes creates unnecessary string allocations and requires multiple engine passes over the input string.
**Action:** When stripping multiple known prefixes from a string, combine the patterns into a single `static readonly` regex using non-capturing groups `(?:...)` and use a single `.replace()` call. This reduces overhead and speeds up string parsing significantly in VS Code command indexing.

## 2025-05-24 - [O(1) Open File Filtering]
**Learning:** In the `SearchEngine`, the `getIndicesForOpenFiles` method iterated over all items (O(N) operation) and normalized paths to check if they were in the `activeFiles` set. This became a bottleneck for large projects.
**Action:** Replace the O(N) iteration with an O(K) lookup by iterating over the `activeFiles` set directly and using the reverse index map `fileToItemIndices` to quickly retrieve the corresponding item indices.
