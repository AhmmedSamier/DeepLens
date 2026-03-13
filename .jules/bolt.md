## 2024-05-25 - [Fast Global Regex Escaping]
**Learning:** In V8/Node.js hot paths, replacing global regex string substitution like `.replace(/[.*+?^\$\{\}()|\[\]\\]/g, '\\$&')` with a manual loop iterating over `charCodeAt` and using `slice` to append string chunks reduces overhead significantly, yielding 3-4x performance gains for escaping regex parameters.
**Action:** When globally escaping special characters in a hot path, consider a manual loop with `charCodeAt` checking against known boundary numbers to avoid global regex engine overhead.

## 2024-05-25 - [Fast Regex Escaping]
**Learning:** In V8/Node.js hot paths (like executing text streams where search relies on escaped string patterns), replacing regex-based string replacements (e.g., `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) with a manual `for` loop that checks character boundaries using `charCodeAt` and appends chunks via `.slice()` is up to 3-4x faster. The manual loop avoids regex compilation, execution overhead, and reduces string allocations.
**Action:** When escaping characters or doing replacements in hot loops, prefer a manual loop using `charCodeAt` and `slice` over regex string replacement, as it provides measurable speed improvements.

## 2024-05-24 - [Fast Backslash Normalization in Hot Paths]
**Learning:** In hot paths (like path normalization during ingestion or search), replacing `.replaceAll('\\', '/')` with an early check `.indexOf('\\') !== -1` followed by `.replace(/\\/g, '/')` is roughly 20-30% faster in Node/V8 and Bun. The chained `replaceAll` or `split.join` incur extra overhead. Furthermore, for C#-generated file checks, `includes` checks coupled with custom reverse `charCodeAt` slicing avoids full string allocation and splitting, resulting in ~15% faster checks.
**Action:** When normalizing file paths in loops or ingestion code, prefer checking for the existence of the character using `indexOf` or `includes` before applying a global regex `replace`. Also avoid full path manipulation (like `replaceAll` then `split`) when checking extensions.

## 2024-05-24 - [Fast URL Segment Processing]
**Learning:** In URL routing paths (`RouteMatcher.prepare`), calling `split('/')` on a pre-lowercased string (`cleanPath.toLowerCase().split('/')`) is ~25% faster than splitting first and then applying `toLowerCase()` to each array element using `map`. Map operations allocate memory per element.
**Action:** Apply global string operations (like `toLowerCase()`) *before* splitting into arrays when you need an array of modified strings, as long as the operation is safe to apply globally.
