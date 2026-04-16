## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2025-02-12 - Persisting User Selection in QuickPick
**Learning:** For a more delightful user experience, small UI choices like active search filters should persist across multiple openings of the UI (VS Code QuickPick). Forgetting the state between invocations causes user friction, particularly for users heavily filtering by scope.
**Action:** When implementing persistence in the VS Code extension, centralize updates in a helper method (e.g., 'setUserSelectedScope') that synchronizes both the in-memory property and the Memento storage to ensure consistency across all UI interaction points (slash commands, filter buttons, query changes).
