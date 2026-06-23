1. **Add `itemFullNameBitflags` and `itemPathBitflags` parallel arrays to `SearchEngine`**
   - Add them to the properties, `clear()`, memory size calculation, and array resizing/truncating logic.
   - Update `computeItemBitflags` to return `fullNameFlags` and `pathFlags` in addition to `nameFlags` and `aggregateFlags`.
   - Update `prepareItemAtIndex` to set these arrays.
2. **Implement O(1) early-exits in fuzzy matchers**
   - In `tryFuzzyMatchFullName`, add a check using `context.itemFullNameBitflags[i]` before running `Fuzzysort.single`.
   - In `tryFuzzyMatchPath`, add a check using `context.itemPathBitflags[i]` before running `Fuzzysort.single`.
   - Add these arrays to `prepareSearchContext`.
3. **Complete pre commit steps**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
4. **Submit the PR**
   - Using title "⚡ Bolt: [O(1) early-exit for fullName and path fuzzy matching]".
