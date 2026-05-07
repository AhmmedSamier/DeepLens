## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-05-07 - Actionable Empty States in Search QuickPick
**Learning:** When users encounter an empty state in a search interface (like a VS Code QuickPick), they often need to manually erase their query to recover. Providing an explicit, actionable recovery path (such as a 'Clear Search' button) directly within the empty state context significantly reduces interaction friction.
**Action:** When designing empty state UI components (e.g. no results found), always ensure there is an immediate, actionable way to clear the current filter/query context built directly into the empty state container rather than relying on external input modifications.
