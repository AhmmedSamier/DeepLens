1. **Analyze Problem:**
   - The memory context says: "Do not replace `Set<number>` with arrays (`number[]`) in reverse indices (like `fileToItemIndices`) that require item removals. While arrays offer faster insertion, using `Array.indexOf` and `Array.splice` for removals introduces a severe O(N) algorithmic performance regression compared to O(1) `Set.delete()`."
   - The field `fileToItemIndices` in `language-server/src/core/search-engine.ts` currently uses `number[]` (`Map<string, number[]>`), and item removal uses `.indexOf` and `.splice`, which is `O(N)`.

2. **Change Field Type:**
   - Update `private readonly fileToItemIndices: Map<string, number[]> = new Map();` to `Map<string, Set<number>>`.

3. **Update Additions:**
   - Instead of initializing as `[]`, initialize as `new Set()`.
   - Instead of `.push(index)`, use `.add(index)`.

4. **Update Removals:**
   - Instead of:
     ```typescript
     const idx = indices.indexOf(index);
     if (idx !== -1) {
         indices.splice(idx, 1);
     }
     if (indices.length === 0) { ... }
     ```
     Use:
     ```typescript
     indices.delete(index);
     if (indices.size === 0) { ... }
     ```

5. **Update Updates (moveFillersToGaps):**
   - Instead of:
     ```typescript
     const idx = indices.indexOf(src);
     if (idx !== -1) {
         indices[idx] = dest;
     } else {
         indices.push(dest);
     }
     ```
     Use:
     ```typescript
     indices.delete(src);
     indices.add(dest);
     ```

6. **Update Reads (Iterations):**
   - In `getIndicesForOpenFiles` and `getIndicesForModifiedFiles`, change `for (let i = 0; i < itemIndices.length; i++)` to `for (const idx of itemIndices) { indices.push(idx); }`.

7. **Verify & Format:**
   - Run `bun run lint` and `bun run test`.
   - Add the required PR title and description format.

8. **Complete pre-commit steps:**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

9. **Submit:**
   - Use title '⚡ Bolt: Change fileToItemIndices to Map<string, Set<number>> for O(1) removals'.
