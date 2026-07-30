1. **Move early-exit checks from helper functions to calling function (`calculateFuzzyScore`)**
   - Use `replace_with_git_merge_diff` to modify `language-server/src/core/search-engine.ts`.
   - Update `calculateFuzzyScore` to perform bitflag checks before calling `tryFuzzyMatchName`, `tryFuzzyMatchFullName`, and `tryFuzzyMatchPath`.
   - Remove the redundant bitflag checks from the helper functions.
2. **Document the performance optimization**
   - Update `.jules/bolt.md` using the exact format with the insight about avoiding function call overhead.
3. **Pre-commit checks**
   - Run formatting (`bun run format` or skip if `oxfmt` is missing).
   - Run tests (`bun run test`) in the `language-server` directory.
   - Follow instructions from `pre_commit_instructions` tool.
4. **Submit PR**
   - Submit changes with PR title `⚡ Bolt: [performance improvement]`.
