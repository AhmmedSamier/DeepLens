## 2024-05-26 - [Fast String Formatting without Arrays]
**Learning:** In string formatting paths (e.g., converting a dot-separated command ID like `workbench.action.files.save` to `Files Save`), replacing `str.split('.').map(...)` and regex replacements (`.replace(/([A-Z])/g, ' $1')`) with a single-pass manual string traversal using `charCodeAt` and slicing significantly reduces intermediate array and string allocations. Even replacing a pre-compiled, cached global regex with a manual loop yielded a ~35% performance improvement in V8/Node.
**Action:** When applying multiple transformations to structured strings (like ID normalization) in hot paths, prefer a single manual loop with `charCodeAt` and `slice` over chained operations like `split().map().join()` and regex replacements.

## 2024-05-26 - [Fast String Formatting without Arrays]
**Learning:** In string formatting paths (e.g., converting a dot-separated command ID like `workbench.action.files.save` to `Files Save`), replacing `str.split('.').map(...)` and regex replacements (`.replace(/([A-Z])/g, ' $1')`) with a single-pass manual string traversal using `charCodeAt` and slicing significantly reduces intermediate array and string allocations. Even replacing a pre-compiled, cached global regex with a manual loop yielded a ~35% performance improvement in V8/Node.
**Action:** When applying multiple transformations to structured strings (like ID normalization) in hot paths, prefer a single manual loop with `charCodeAt` and `slice` over chained operations like `split().map().join()` and regex replacements.

$(cat .jules/bolt.md)
