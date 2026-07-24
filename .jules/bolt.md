## 2024-07-24 - SearchEngine Hot Path GC Optimization
**Learning:** Frequent small allocations (like `new Set` or `new Uint8Array(256)`) in hot loops cause significant GC overhead, especially during burst searches.
**Action:** Use class-level reusable buffers (e.g., `reusablePriorityTypeIds`, `burstUrlMatchIdsCache`) that are cleared and repopulated per call to eliminate memory allocations in hot paths.
