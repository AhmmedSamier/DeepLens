## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2026-04-13 - Dynamic Empty State Watermarks
**Learning:** In applications with multiple scopes or filters, using a generic static string for watermarks/placeholders reduces feature discoverability and screen reader context.
**Action:** Bind empty state visual properties (TextBlock.Text) and accessibility attributes (TextBox.ToolTip, AutomationProperties.Name) to a dynamic property reacting to the selected filter state.
