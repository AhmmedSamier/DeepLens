## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-05-18 - Dynamic Placeholders in WPF Search Controls
**Learning:** In WPF applications with multiple scopes or filters (like DeepLens Search Everywhere), using a generic static placeholder string (e.g., "Search for classes, symbols...") fails to inform the user about their currently selected filter scope.
**Action:** Bind the empty state watermark/placeholder (both `TextBox.ToolTip`/`AutomationProperties.Name` and the visual `TextBlock.Text`) to a dynamic string property that computes a contextual placeholder based on the currently active filter, improving feature discoverability and screen reader context.
