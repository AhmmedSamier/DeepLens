## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-04-18 - Context-Aware Placeholders in Empty States

**Learning:** In C# WPF applications (and UIs generally), when users select a filter (e.g., "Classes" vs "Files"), leaving a generic placeholder in the empty state (like "Search for classes, symbols, files, text, or endpoints") fails to reinforce the active scope.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state.
