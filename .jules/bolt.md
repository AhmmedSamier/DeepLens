## 2026-03-07 - [Optimize Chained String Replacements]
**Learning:** In hot paths like `CommandIndexer.commandIdToTitle`, chaining multiple `.replaceAll` operations sequentially with different regexes creates unnecessary string allocations and requires multiple engine passes over the input string.
**Action:** When stripping multiple known prefixes from a string, combine the patterns into a single `static readonly` regex using non-capturing groups `(?:...)` and use a single `.replace()` call. This reduces overhead and speeds up string parsing significantly in VS Code command indexing.

## 2026-03-10 - [Optimize replaceAll with global regex]
**Learning:** In JavaScript/TypeScript hot paths (like regex escaping in `SearchEngine.escapeRegExp`), using `.replace(/.../g, ...)` with a global regex is faster than `.replaceAll(/.../g, ...)`. This is because `.replaceAll` incurs additional overhead validating the presence of the global 'g' flag, whereas `.replace` with a global regex achieves the same result directly.
**Action:** When performing global regex replacements in performance-critical code, prefer `.replace(/.../g, ...)` over `.replaceAll(/.../g, ...)` to eliminate unnecessary validation overhead.

## 2026-03-11 - [Optimize Regex Extraction of Method Prefixes]
**Learning:** In hot paths (like `RouteMatcher.getOrCompileCache`), replacing a simple regex extraction (`/^\[([A-Z]+)\]/`) and string replace operation with manual `charCodeAt`, `indexOf`, and `slice` operations can speed up prefix extraction and string trimming by approximately ~3x.
**Action:** Replace regular expressions used for prefix extraction in high-frequency string parsing algorithms with manual string scans. However, ensure that readability isn't significantly degraded or use `eslint-disable` cautiously (e.g., `sonarjs/no-undefined-assignment`) when setting default fallback values.
