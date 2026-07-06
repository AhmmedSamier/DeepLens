1.  **Add `itemPathBitflags` to `SearchEngine`**
    *   Initialize `private itemPathBitflags: Uint32Array = new Uint32Array(0);` around line 153.
    *   Initialize it in `setItems()`: `this.itemPathBitflags = new Uint32Array(items.length);`.
    *   Expand it in `ensureCapacity()` similarly to `itemFullNameBitflags`.
    *   Truncate it in `truncateArrays()` similarly to `itemFullNameBitflags`.
    *   Move it in `moveItem()` similarly to `itemFullNameBitflags`.
    *   Clear it in `clear()` similarly to `itemFullNameBitflags`.
    *   Add to `getCacheSize()` memory calculation similarly to `itemFullNameBitflags`.

2.  **Update `computeItemBitflags` to return `pathFlags`**
    *   Modify `computeItemBitflags` to compute and return `pathFlags`:
        ```typescript
        let pathFlags = 0;
        if (item.relativeFilePath) {
            pathFlags = this.calculateBitflags(item.relativeFilePath);
            aggregateFlags |= pathFlags;
        }
        return { nameFlags, fullNameFlags, pathFlags, aggregateFlags };
        ```
    *   Update the calling code in `prepareItemAtIndex` to set `this.itemPathBitflags[index] = pathFlags;`.

3.  **Update `prepareSearchContext` to pass `itemPathBitflags`**
    *   Include `itemPathBitflags: this.itemPathBitflags` in the returned context object.

4.  **Add O(1) Bitflag Early-Exit to `tryFuzzyMatchPath`**
    *   Modify `tryFuzzyMatchPath` to check `itemPathBitflags` before executing expensive `Fuzzysort.single`:
        ```typescript
        // ⚡ Bolt: Fast early-exit for path property fuzzy matching
        if ((context.itemPathBitflags[i] & context.queryBitflags) !== context.queryBitflags) {
            return -Infinity;
        }
        ```

5.  **Run tests and benchmarks to verify correctness and performance improvement.**

6.  **Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.**
