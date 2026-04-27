## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2024-05-24 - Dynamic Contextual Search Placeholders
**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.
## 2024-05-18 - Added "Popular Commands" to Search QuickPick
**Learning:** Adding a small, well-placed "Popular" list to existing slash-command auto-suggestions significantly improves discoverability of common workflows (e.g. `/files`, `/txt`, `/symbols`) for new users without overwhelming them or demanding major layout changes. Using icons (like `$(star)`) provides a clear visual distinction from generic and recent commands.
**Action:** When working on UI menus or dropdowns, look for opportunities to explicitly surface high-value interactions natively rather than relying on users to guess functionality. Always apply distinct but subtle visual hierarchy (like prefixed icons) to differentiate item categories in flat lists.
