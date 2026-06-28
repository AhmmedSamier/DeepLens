1. **Title and Description**
   - Title: "⚡ Bolt: Add fast early-exit for fullName property fuzzy matching"
   - Description sections:
     - 💡 What: Added `itemFullNameBitflags` array to pre-compute and store character bitflags specifically for the `fullName` property of items, and added an O(1) early-exit check in `tryFuzzyMatchFullName` to bypass expensive `Fuzzysort.single` evaluations if the required query characters are not present in the full name.
     - 🎯 Why: Even if an item passes the aggregate bitflag check (`itemBitflags`), which includes `name`, `fullName`, and `relativeFilePath`, the `fullName` property itself might not contain the necessary query characters. We are avoiding expensive evaluations when the query characters are actually spread across the other fields.
     - 📊 Impact: Significantly reduces wasted `Fuzzysort.single` CPU cycles during fallback search processing for full names that don't match, yielding faster search times and lower memory/GC churn during rapid typing.
     - 🔬 Measurement: Observe lower CPU profiles on `Fuzzysort.single` calls and decreased search execution times in hot paths.

2. **Add `itemFullNameBitflags` tracking in `search-engine.ts`**
   - I have already applied the following modifications using my custom JS script:
     - Added `private itemFullNameBitflags: Uint32Array = new Uint32Array(0);`
     - Updated `setItems`, `reallocateParallelArrays`, `truncateArrays`, `moveItem`, and `clear` to properly allocate, resize, slice, shift, and clear `this.itemFullNameBitflags`.
     - Updated `computeItemBitflags` to extract and return `fullNameFlags` individually.
     - Updated `prepareItemAtIndex` to apply the computed `fullNameFlags` to the new parallel array.
     - Updated `getMemoryUsage` to track `this.itemFullNameBitflags.byteLength`.
     - Updated `prepareSearchContext` to pass `itemFullNameBitflags` into the context.

3. **Add Early Exit in `tryFuzzyMatchFullName`**
   - I have already applied the modification to use `context.itemFullNameBitflags[i]` in `tryFuzzyMatchFullName`.

4. **Verify tests and linter**
   - Run `cd language-server && bun install`, `bun run lint`, `bun run build`, and `bun run test` to ensure there are no regressions.
   - Run `cd vscode-extension && bun install`, `bun run lint`, and `xvfb-run bun run test`.

5. **Create `.jules/bolt.md` entry**
   - Add the following entry to the Bolt journal:
     ```markdown
     ## 2024-06-20 - [Fast FullName Property Early-Exit]
     **Learning:** Similar to the name property early-exit, even if an item passes the aggregate bitflag check (`itemBitflags`) which considers the `name`, `fullName`, and `relativeFilePath`, we shouldn't immediately assume the `fullName` property itself contains all the characters. The fallback path runs `tryFuzzyMatchFullName` for items, resulting in wasted `Fuzzysort.single` evaluations if the query characters matched due to other fields.
     **Action:** Added `itemFullNameBitflags` to track bitflags specifically for the `fullName` property, enabling a second O(1) early-exit check inside `tryFuzzyMatchFullName` (`(context.itemFullNameBitflags[i] & context.queryBitflags) !== context.queryBitflags`). This immediately skips expensive evaluation when the query characters are actually spread across the name or file path.
     ```

6. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
   - Run `pre_commit_instructions` and follow the steps.

7. **Submit the PR**
   - Commit and submit the code changes.
