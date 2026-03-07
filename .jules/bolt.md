## 2024-05-24 - [Optimize Chained String Replacements]
**Learning:** In hot paths like `CommandIndexer.commandIdToTitle`, chaining multiple `.replaceAll` operations sequentially with different regexes creates unnecessary string allocations and requires multiple engine passes over the input string.
**Action:** When stripping multiple known prefixes from a string, combine the patterns into a single `static readonly` regex using non-capturing groups `(?:...)` and use a single `.replace()` call. This reduces overhead and speeds up string parsing significantly in VS Code command indexing.
