## 2024-05-26 - [Fast Array Pre-allocation over Map]
**Learning:** In hot paths (like `RouteMatcher.precompute`), replacing `Array.prototype.map()` with a pre-allocated array (`new Array(length)`) and a manual `for` loop is significantly faster. Avoiding `.map()` eliminates the callback overhead and memory allocations for the new array elements, resulting in ~15-20% faster boolean array creation.
**Action:** When creating fixed-size arrays from existing arrays in performance-critical sections, prefer using `new Array(length)` with a manual `for` loop over `Array.prototype.map()`. Remember to bypass the SonarJS rule with `// eslint-disable-next-line sonarjs/array-constructor`.

## 2024-05-25 - [Fast String Formatting]
**Learning:** In string formatting paths (e.g., converting IDs to titles with capitalization and delimiters), replacing regex operations and `.split().map().join()` chains with a single-pass manual string traversal (using `charCodeAt` and building the string iteratively) significantly reduces intermediate array/string allocations. This approach can be ~3x faster than cached regex replacements and `.trim()`.
**Action:** When repeatedly formatting short strings (like command IDs) in loops, prefer a single-pass manual loop over chaining native string array methods or using global regex `replace`.

## 2024-05-25 - [Fast Regex Escaping]
**Learning:** In V8/Node.js hot paths (like executing text streams where search relies on escaped string patterns), replacing regex-based string replacements (e.g., `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) with a manual `for` loop that checks character boundaries using `charCodeAt` and appends chunks via `.slice()` is up to 3-4x faster. The manual loop avoids regex compilation, execution overhead, and reduces string allocations.
**Action:** When escaping characters or doing replacements in hot loops, prefer a manual loop using `charCodeAt` and `slice` over regex string replacement, as it provides measurable speed improvements.

## 2024-05-24 - [Fast Backslash Normalization in Hot Paths]
**Learning:** In hot paths (like path normalization during ingestion or search), replacing `.replaceAll('\\', '/')` with an early check `.indexOf('\\') !== -1` followed by `.replace(/\\/g, '/')` is roughly 20-30% faster in Node/V8 and Bun. The chained `replaceAll` or `split.join` incur extra overhead. Furthermore, for C#-generated file checks, `includes` checks coupled with custom reverse `charCodeAt` slicing avoids full string allocation and splitting, resulting in ~15% faster checks.
**Action:** When normalizing file paths in loops or ingestion code, prefer checking for the existence of the character using `indexOf` or `includes` before applying a global regex `replace`. Also avoid full path manipulation (like `replaceAll` then `split`) when checking extensions.

## 2024-05-24 - [Fast URL Segment Processing]
**Learning:** In URL routing paths (`RouteMatcher.prepare`), calling `split('/')` on a pre-lowercased string (`cleanPath.toLowerCase().split('/')`) is ~25% faster than splitting first and then applying `toLowerCase()` to each array element using `map`. Map operations allocate memory per element.
**Action:** Apply global string operations (like `toLowerCase()`) *before* splitting into arrays when you need an array of modified strings, as long as the operation is safe to apply globally.
