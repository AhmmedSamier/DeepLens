## 2024-05-24 - Double String Scan in Loops
**Learning:** `includes()` followed by `indexOf()` is a common anti-pattern that causes double iteration over strings. In hot loops (like search scoring), this adds significant overhead. `indexOf() !== -1` performs the same check in a single pass.
**Action:** Always check for `includes` usage in hot paths and replace with `indexOf` check if the index is needed later.
