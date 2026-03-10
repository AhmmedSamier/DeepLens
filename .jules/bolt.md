## 2024-05-24 - Fast RegExp Escaping
**Learning:** In V8/Node.js hot paths (e.g., executing text streams where search relies on escaped string patterns), the common idiom `.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` causes significant allocation and engine pass overhead. Replacing this with a manual iteration `for` loop that checks character boundaries using `charCodeAt` and appends chunks via `.slice` is up to 3-4x faster than using a regex.
**Action:** Use manual iteration, `charCodeAt`, and `.slice` over `.replace` with regex for hot path string character transformations.
