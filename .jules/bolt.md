## 2024-05-24 - Double String Scan in Loops
**Learning:** `includes()` followed by `indexOf()` is a common anti-pattern that causes double iteration over strings. In hot loops (like search scoring), this adds significant overhead. `indexOf() !== -1` performs the same check in a single pass.
**Action:** Always check for `includes` usage in hot paths and replace with `indexOf` check if the index is needed later.

## 2024-05-24 - Heap Pre-Check Optimization
**Learning:** In top-K search loops, creating result objects before checking if they qualify for the heap (when the heap is full) creates unnecessary GC pressure. Checking `heap.isFull() && newScore <= heap.peek().score` prevents this allocation for the vast majority of items in large datasets.
**Action:** Implement "peek and skip" logic in any hot loop that feeds a bounded priority queue.
