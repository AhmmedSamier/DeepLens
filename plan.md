1. **Optimize `tryUrlEndpointMatch` method in `SearchEngine`**
   - In single-threaded, sequential hot loops, returning freshly allocated objects (e.g., `{ score: number; scope: SearchScope } | null`) results in heavy memory churn and GC pauses.
   - Refactor `tryUrlEndpointMatch` to return a `number` (`matchScore` or `-Infinity`).
   - Move the scope assignment (`SearchScope.ENDPOINTS`) to the caller site (`processItemForSearch`) directly.
2. **Complete pre-commit steps**
   - Run `pre_commit_instructions` and execute required checks.
3. **Submit the change**
   - Submit the PR with the required `⚡ Bolt: [performance improvement]` title and format.
