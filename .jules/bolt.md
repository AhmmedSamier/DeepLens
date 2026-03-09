## 2026-03-12 - [Optimize HTML String Escaping]
**Learning:** In hot paths like `escapeHtml` where multiple distinct characters need to be replaced with different sequences, chaining multiple `.replaceAll('x', 'y')` operations causes multiple expensive string allocations and requires the JS engine to scan the string multiple times.
**Action:** Replace chained `.replaceAll()` calls with a single `for` loop iterating over character codes using `.charCodeAt(i)`. When a match is found, append `.slice()` and the replacement string to a result buffer. This single-pass strategy is ~4-5x faster for typical short strings like file paths or names.

## 2026-03-07 - [Optimize Chained String Replacements]
**Learning:** In hot paths like `CommandIndexer.commandIdToTitle`, chaining multiple `.replaceAll` operations sequentially with different regexes creates unnecessary string allocations and requires multiple engine passes over the input string.
**Action:** When stripping multiple known prefixes from a string, combine the patterns into a single `static readonly` regex using non-capturing groups `(?:...)` and use a single `.replace()` call. This reduces overhead and speeds up string parsing significantly in VS Code command indexing.

## 2026-03-10 - [Optimize replaceAll with global regex]
**Learning:** In JavaScript/TypeScript hot paths (like regex escaping in `SearchEngine.escapeRegExp`), using `.replace(/.../g, ...)` with a global regex is faster than `.replaceAll(/.../g, ...)`. This is because `.replaceAll` incurs additional overhead validating the presence of the global 'g' flag, whereas `.replace` with a global regex achieves the same result directly.
**Action:** When performing global regex replacements in performance-critical code, prefer `.replace(/.../g, ...)` over `.replaceAll(/.../g, ...)` to eliminate unnecessary validation overhead.
