1. **Initialize class properties for caching objects to reduce GC overhead**
   Use `replace_with_git_merge_diff` to modify `language-server/src/core/search-engine.ts`. Add reusable class buffers `reusablePriorityTypeIds` and `burstUrlMatchIdsCache` inside `SearchEngine`.
   ```
   <<<<<<< SEARCH
       // String normalization cache (1-item) for relativeFilePath
       private lastRelativeInput: string | null = null;
   =======
       // String normalization cache (1-item) for relativeFilePath
       private lastRelativeInput: string | null = null;

       // ⚡ Bolt: Class-level buffers to eliminate per-call allocations in hot loops
       private reusablePriorityTypeIds: Uint8Array = new Uint8Array(256);
       private burstUrlMatchIdsCache: Set<string> = new Set<string>();
   >>>>>>> REPLACE
   ```

2. **Verify changes to SearchEngine properties**:
   Use `run_in_bash_session` to execute `git diff --staged` to confirm the class properties were added successfully.

3. **Hoist early-exits to calculateFuzzyScore to reduce function call overhead**
   Use `replace_with_git_merge_diff` to modify `language-server/src/core/search-engine.ts`. Update `calculateFuzzyScore`, `tryFuzzyMatchName`, `tryFuzzyMatchFullName`, and `tryFuzzyMatchPath` to inline the bitflag checks and avoid function call overhead for immediately rejected items.
   ```
   <<<<<<< SEARCH
       private calculateFuzzyScore(
           i: number,
           typeId: number,
           context: ReturnType<typeof this.prepareSearchContext>,
       ): number {
           // Try matching against name (weight: 1.0)
           const nameScore = this.tryFuzzyMatchName(i, context);

           // Try matching against full name (weight: 0.9) if name score is not high enough
           const fullNameScore = nameScore < 0.9 ? this.tryFuzzyMatchFullName(i, context) : -Infinity;
           const bestNameOrFull = fullNameScore > nameScore ? fullNameScore : nameScore;

           // Try matching against path (weight: 0.8) if still not high enough
           const pathScore = bestNameOrFull < 0.8 ? this.tryFuzzyMatchPath(i, context) : -Infinity;
           let fuzzyScore = pathScore > bestNameOrFull ? pathScore : bestNameOrFull;

           // Apply type boost to final fuzzy score
           if (fuzzyScore > context.MIN_SCORE) {
               const typeBoost = ID_TO_BOOST[typeId] || 1;
               fuzzyScore *= typeBoost;
           }

           return fuzzyScore;
       }

       private tryFuzzyMatchName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           // ⚡ Bolt: Fast early-exit for name property fuzzy matching
           // Even if the item passes the aggregate bitflag check, we can skip expensive
           // fuzzy sorting on the name property if it doesn't contain the required characters.
           if ((context.itemNameBitflags[i] & context.queryBitflags) !== context.queryBitflags) {
               return -Infinity;
           }

           const pName = context.preparedNames[i];
           if (!pName) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pName);
           if (res && res.score > context.MIN_SCORE) {
               context.currentHighlights = this.indexesToHighlights(res.indexes);
               return res.score;
           }
           return -Infinity;
       }

       private tryFuzzyMatchFullName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           // ⚡ Bolt: Fast early-exit for fullName property fuzzy matching
           // Skip expensive fuzzy sorting on the fullName property if it doesn't contain the required characters.
           if ((context.itemFullNameBitflags[i] & context.queryBitflags) !== context.queryBitflags) {
               return -Infinity;
           }

           const pFull = context.preparedFullNames[i];
           if (!pFull) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pFull);
           return res ? res.score * 0.9 : -Infinity;
       }

       private tryFuzzyMatchPath(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           // ⚡ Bolt: Fast early-exit for path property fuzzy matching
           // Skip expensive fuzzy sorting on the path property if it doesn't contain the required characters.
           if ((context.itemPathBitflags[i] & context.queryBitflags) !== context.queryBitflags) {
               return -Infinity;
           }

           const pPath = context.preparedPaths[i];
           if (!pPath) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pPath);
           return res ? res.score * 0.8 : -Infinity;
       }
   =======
       private calculateFuzzyScore(
           i: number,
           typeId: number,
           context: ReturnType<typeof this.prepareSearchContext>,
       ): number {
           // Try matching against name (weight: 1.0)
           // ⚡ Bolt: Hoisted bitmask checks outside of the helper functions directly into the calling loop
           // to avoid function call overhead for immediately rejected items.
           const nameScore = (context.itemNameBitflags[i] & context.queryBitflags) === context.queryBitflags
               ? this.tryFuzzyMatchName(i, context)
               : -Infinity;

           // Try matching against full name (weight: 0.9) if name score is not high enough
           const fullNameScore = (nameScore < 0.9 && (context.itemFullNameBitflags[i] & context.queryBitflags) === context.queryBitflags)
               ? this.tryFuzzyMatchFullName(i, context)
               : -Infinity;
           const bestNameOrFull = fullNameScore > nameScore ? fullNameScore : nameScore;

           // Try matching against path (weight: 0.8) if still not high enough
           const pathScore = (bestNameOrFull < 0.8 && (context.itemPathBitflags[i] & context.queryBitflags) === context.queryBitflags)
               ? this.tryFuzzyMatchPath(i, context)
               : -Infinity;
           let fuzzyScore = pathScore > bestNameOrFull ? pathScore : bestNameOrFull;

           // Apply type boost to final fuzzy score
           if (fuzzyScore > context.MIN_SCORE) {
               const typeBoost = ID_TO_BOOST[typeId] || 1;
               fuzzyScore *= typeBoost;
           }

           return fuzzyScore;
       }

       private tryFuzzyMatchName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           const pName = context.preparedNames[i];
           if (!pName) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pName);
           if (res && res.score > context.MIN_SCORE) {
               context.currentHighlights = this.indexesToHighlights(res.indexes);
               return res.score;
           }
           return -Infinity;
       }

       private tryFuzzyMatchFullName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           const pFull = context.preparedFullNames[i];
           if (!pFull) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pFull);
           return res ? res.score * 0.9 : -Infinity;
       }

       private tryFuzzyMatchPath(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
           const pPath = context.preparedPaths[i];
           if (!pPath) {
               return -Infinity;
           }

           const res = Fuzzysort.single(context.query, pPath);
           return res ? res.score * 0.8 : -Infinity;
       }
   >>>>>>> REPLACE
   ```

4. **Verify hoisted checks in calculateFuzzyScore**:
   Use `run_in_bash_session` to execute `git diff --staged` to confirm the code structure has updated properly.

5. **Reuse pre-allocated `reusablePriorityTypeIds` array instead of creating new Uint8Array**:
   Use `replace_with_git_merge_diff` to modify `language-server/src/core/search-engine.ts`. Update `searchRemainingItems`.
   ```
   <<<<<<< SEARCH
       private searchRemainingItems(
           priorityScopes: SearchScope[],
           maxResults: number,
           processItem: (i: number) => void,
           results: SearchResult[],
           token?: CancellationToken,
       ): void {
           // ⚡ Bolt: Fast Remaining Scopes Iteration Optimization
           // Instead of allocating a Uint8Array of size N to track already processed items,
           // we precompute which type IDs belong to priority scopes and iterate sequentially.
           // This avoids the large allocation while preserving the exact iteration order of the fallback pass.
           const prioritySet = new Set(priorityScopes);
           const isPriorityTypeId = new Uint8Array(256);
           for (let i = 0; i < ID_TO_SCOPE.length; i++) {
               if (prioritySet.has(ID_TO_SCOPE[i])) {
                   isPriorityTypeId[i] = 1;
               }
           }

           const itemsLength = this.items.length;
           const itemTypeIds = this.itemTypeIds;

           for (let i = 0; i < itemsLength; i++) {
               if (results.length >= maxResults || token?.isCancellationRequested) break;
               if (isPriorityTypeId[itemTypeIds[i]] === 0) {
                   processItem(i);
               }
           }
       }
   =======
       private searchRemainingItems(
           priorityScopes: SearchScope[],
           maxResults: number,
           processItem: (i: number) => void,
           results: SearchResult[],
           token?: CancellationToken,
       ): void {
           // ⚡ Bolt: Fast Remaining Scopes Iteration Optimization
           // Instead of allocating a Uint8Array of size N to track already processed items,
           // we precompute which type IDs belong to priority scopes and iterate sequentially.
           // This avoids the large allocation while preserving the exact iteration order of the fallback pass.
           // Using a class-level buffer avoids allocating a new Uint8Array on every call.
           const prioritySet = new Set(priorityScopes);
           this.reusablePriorityTypeIds.fill(0);
           for (let i = 0; i < ID_TO_SCOPE.length; i++) {
               if (prioritySet.has(ID_TO_SCOPE[i])) {
                   this.reusablePriorityTypeIds[i] = 1;
               }
           }

           const itemsLength = this.items.length;
           const itemTypeIds = this.itemTypeIds;

           for (let i = 0; i < itemsLength; i++) {
               if (results.length >= maxResults || token?.isCancellationRequested) break;
               if (this.reusablePriorityTypeIds[itemTypeIds[i]] === 0) {
                   processItem(i);
               }
           }
       }
   >>>>>>> REPLACE
   ```

6. **Verify reusablePriorityTypeIds fix**:
   Use `run_in_bash_session` to execute `git diff --staged` to confirm the function was updated successfully.

7. **Reuse pre-allocated `burstUrlMatchIdsCache` Set instead of creating a new Set**:
   Use `replace_with_git_merge_diff` to modify `language-server/src/core/search-engine.ts`. Update `addUrlMatches`.
   ```
   <<<<<<< SEARCH
       // Kept for burstSearch usage
       private addUrlMatches(
           results: SearchResult[],
           indices: number[] | undefined,
           queryOrPrepared: string | PreparedPath,
           maxResults?: number,
       ): void {
           // ⚡ Bolt: Fast Set initialization
           // Replaces new Set(results.map(r => r.item.id)) with a manual loop to avoid intermediate array allocation
           // Performance impact: ~30-40% faster unique tracking for URL matches
           const existingIds = new Set<string>();
           const resultsLen = results.length;
           for (let j = 0; j < resultsLen; j++) {
               existingIds.add(results[j].item.id);
           }

           const checkItem = (i: number) => {
               if (maxResults && results.length >= maxResults) return;

               const item = this.items[i];
               if (item.type === SearchItemType.ENDPOINT && !existingIds.has(item.id)) {
                   const pattern = this.preparedPatterns[i];
                   const score = pattern
                       ? RouteMatcher.scoreMatchPattern(pattern, queryOrPrepared)
                       : RouteMatcher.scoreMatch(item.name, queryOrPrepared);

                   if (score > 0) {
                       results.push({
                           item,
                           score,
                           scope: SearchScope.ENDPOINTS,
                       });
                       existingIds.add(item.id);
                   }
               }
           };

           if (indices) {
               for (const i of indices) {
                   if (maxResults && results.length >= maxResults) break;
                   checkItem(i);
               }
           } else {
               for (let i = 0; i < this.items.length; i++) {
                   if (maxResults && results.length >= maxResults) break;
                   checkItem(i);
               }
           }
       }
   =======
       // Kept for burstSearch usage
       private addUrlMatches(
           results: SearchResult[],
           indices: number[] | undefined,
           queryOrPrepared: string | PreparedPath,
           maxResults?: number,
       ): void {
           // ⚡ Bolt: Fast Set initialization
           // Replaces new Set(results.map(r => r.item.id)) with a manual loop to avoid intermediate array allocation
           // Using a class-level Set avoids allocating a new Set on every call.
           // Performance impact: ~30-40% faster unique tracking for URL matches
           this.burstUrlMatchIdsCache.clear();
           const resultsLen = results.length;
           for (let j = 0; j < resultsLen; j++) {
               this.burstUrlMatchIdsCache.add(results[j].item.id);
           }

           const checkItem = (i: number) => {
               if (maxResults && results.length >= maxResults) return;

               const item = this.items[i];
               if (item.type === SearchItemType.ENDPOINT && !this.burstUrlMatchIdsCache.has(item.id)) {
                   const pattern = this.preparedPatterns[i];
                   const score = pattern
                       ? RouteMatcher.scoreMatchPattern(pattern, queryOrPrepared)
                       : RouteMatcher.scoreMatch(item.name, queryOrPrepared);

                   if (score > 0) {
                       results.push({
                           item,
                           score,
                           scope: SearchScope.ENDPOINTS,
                       });
                       this.burstUrlMatchIdsCache.add(item.id);
                   }
               }
           };

           if (indices) {
               for (const i of indices) {
                   if (maxResults && results.length >= maxResults) break;
                   checkItem(i);
               }
           } else {
               for (let i = 0; i < this.items.length; i++) {
                   if (maxResults && results.length >= maxResults) break;
                   checkItem(i);
               }
           }
       }
   >>>>>>> REPLACE
   ```

8. **Verify burstUrlMatchIdsCache fix**:
   Use `run_in_bash_session` to execute `git diff --staged` to confirm the function was updated successfully.

9. **Install packages in vscode-extension**: Use `run_in_bash_session` to run `cd vscode-extension && bun install`.
10. **Install packages in language-server**: Use `run_in_bash_session` to run `cd language-server && bun install`.
11. **Build language-server**: Use `run_in_bash_session` to run `cd language-server && bun run build`.
12. **Run lint and format**: Use `run_in_bash_session` to run `bun run lint && bun run format`.
13. **Run language-server tests**: Use `run_in_bash_session` to run `cd language-server && bun run test`.
14. **Run vscode-extension tests**: Use `run_in_bash_session` to run `cd vscode-extension && xvfb-run -a bun run test:full`.

15. **Journal entry**: Use `run_in_bash_session` to run `cat << 'INNER_EOF' >> .jules/bolt.md
## $(date +%Y-%m-%d) - Reduce function call and GC allocation overhead
**Learning:** In highly optimized fuzzy matching hot loops and search code paths, hoisting property-specific bitflag early-exit checks to outside the helper functions and into the calling loop eliminates function call overhead for immediately rejected items. Using class-level reusable buffers (like Uint8Arrays and Sets) instead of allocating objects locally in a function reduces GC pressure and speeds up the search.
**Action:** When working on performance-critical code paths with large datasets (like `SearchEngine`), prefer hoisting static early-exits to the caller context and implement reusable struct-of-arrays or buffers at the module/class scope to prevent unnecessary O(1) allocation overheads across loop iterations or frequent functional invocations.
INNER_EOF` to add a journal entry.

16. **Verify journal entry**: Use `run_in_bash_session` to run `cat .jules/bolt.md` to make sure it was appended correctly.

17. **Pre commit**: Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

18. **Submit**: Use `submit` to create PR with title `⚡ Bolt: [performance improvement] Reduce GC allocations and function call overhead in search hot paths` and branch `bolt-optimize-search-engine-gc-and-fn-overhead`.
