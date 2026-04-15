## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2024-04-16 - Dynamic Search Placeholders in WPF
**Learning:** In WPF applications with multiple scopes or filters, using a generic static string for the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) provides poor feature discoverability and screen reader context.
**Action:** Bind the empty state watermark and accessibility properties to a dynamic property that reacts to the selected filter state, providing contextual hints (e.g., "Search for classes (e.g. UserService, /c...)").
