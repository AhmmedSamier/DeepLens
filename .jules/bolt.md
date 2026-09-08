## 2024-05-18 - Avoid Repeated Date.now() and Constant Math in Hot Loops
**Learning:** Calling Date.now() repeatedly inside a hot loop and recalculating constant math like 1000 * 60 * 60 * 24 severely degrades performance. In V8 (Node.js/Bun), pulling these operations out of the loop and passing them as arguments allows for much faster execution.
**Action:** Always hoist Date.now() and precalculate constants outside of hot loops, passing them down to score calculation functions instead of recomputing them repeatedly per item.

## 2024-05-18 - Avoid Repeated Date.now() and Constant Math in Hot Loops
**Learning:** Calling Date.now() repeatedly inside a hot loop and recalculating constant math like 1000 * 60 * 60 * 24 severely degrades performance. In V8 (Node.js/Bun), pulling these operations out of the loop and passing them as arguments allows for much faster execution.
**Action:** Always hoist Date.now() and precalculate constants outside of hot loops, passing them down to score calculation functions instead of recomputing them repeatedly per item.
