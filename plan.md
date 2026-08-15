1. **Analyze `tryFuzzyMatchPath` in `SearchEngine`:**
   - I see `tryFuzzyMatchPath` already has an early exit check: `if ((context.itemPathBitflags[i] & context.queryBitflags) !== context.queryBitflags)`. This is good.
2. **Review performance learnings from memory/bolt.md:**
   - "Avoid O(n) early-exits inside helper functions in hot loops" -> Moving simple boolean or bitmask early-exit checks to the very top of the calling loop method to skip function calls entirely for non-matching items.
3. **Check where `tryFuzzyMatchPath`, `tryFuzzyMatchFullName`, `tryFuzzyMatchName` are called:**
   - They are called in `calculateFuzzyScore`.
   - `calculateFuzzyScore` is called in `calculateSearchScore`.
   - `calculateSearchScore` is called in `processItemForSearch`.
   - In `processItemForSearch`, there's an aggregate bitflag check: `const passesBitflag = (context.itemBitflags[i] & context.queryBitflags) === context.queryBitflags;`
   - In `calculateFuzzyScore`:
     ```typescript
     const nameScore = this.tryFuzzyMatchName(i, context);
     const fullNameScore = nameScore < 0.9 ? this.tryFuzzyMatchFullName(i, context) : -Infinity;
     const bestNameOrFull = fullNameScore > nameScore ? fullNameScore : nameScore;
     const pathScore = bestNameOrFull < 0.8 ? this.tryFuzzyMatchPath(i, context) : -Infinity;
     ```
   - If I move the bitflag checks out of `tryFuzzyMatchName`, `tryFuzzyMatchFullName`, and `tryFuzzyMatchPath` into `calculateFuzzyScore` (or modify the helper calls), I can avoid the function call overhead.
   - Wait, `calculateFuzzyScore` is already a helper function. Moving them inside `calculateFuzzyScore` avoids the call to `tryFuzzyMatch...`.
   - But wait, memory says: "In fuzzy matching hot loops (like SearchEngine), use property-specific bitflag arrays ... to perform O(1) early-exit checks before executing expensive property-specific fuzzy matching algorithms ... Crucially, place these bitmask checks *outside* of the helper functions directly in the calling loop to avoid function call overhead for immediately rejected items."
4. **Proposed changes to `calculateFuzzyScore`:**
   ```typescript
   private calculateFuzzyScore(
       i: number,
       typeId: number,
       context: ReturnType<typeof this.prepareSearchContext>,
   ): number {
       // Try matching against name (weight: 1.0)
       let nameScore = -Infinity;
       if ((context.itemNameBitflags[i] & context.queryBitflags) === context.queryBitflags) {
           nameScore = this.tryFuzzyMatchName(i, context);
       }

       // Try matching against full name (weight: 0.9) if name score is not high enough
       let fullNameScore = -Infinity;
       if (nameScore < 0.9 && (context.itemFullNameBitflags[i] & context.queryBitflags) === context.queryBitflags) {
           fullNameScore = this.tryFuzzyMatchFullName(i, context);
       }
       const bestNameOrFull = fullNameScore > nameScore ? fullNameScore : nameScore;

       // Try matching against path (weight: 0.8) if still not high enough
       let pathScore = -Infinity;
       if (bestNameOrFull < 0.8 && (context.itemPathBitflags[i] & context.queryBitflags) === context.queryBitflags) {
           pathScore = this.tryFuzzyMatchPath(i, context);
       }
       let fuzzyScore = pathScore > bestNameOrFull ? pathScore : bestNameOrFull;

       ...
   }
   ```
   And then I can remove the redundant bitflag checks from the `tryFuzzyMatch*` functions.

5. **Let's double check if we can inline the rest or keep them as helper functions.**
   The memory specifically says: "place these bitmask checks *outside* of the helper functions directly in the calling loop to avoid function call overhead for immediately rejected items."
   So placing them in `calculateFuzzyScore` wrapping the calls to `tryFuzzyMatchName`, `tryFuzzyMatchFullName`, `tryFuzzyMatchPath` perfectly aligns with this.

