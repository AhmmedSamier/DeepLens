## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2024-05-24 - Dynamic Contextual Search Placeholders
**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.
## 2024-06-11 - Persisting Context Defaults
**Learning:** Forcing a user to re-select a specific search scope (like `/m` for modified files) every time they open a search dialog creates friction.
**Action:** Use `vscode.Memento` to persist user scope selections across sessions. Centralize the state update in a setter to guarantee synchronization between in-memory values and persistent storage across all UI interaction points.
