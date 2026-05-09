## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-04-18 - Context-Aware Placeholders in Empty States

**Learning:** In C# WPF applications (and UIs generally), when users select a filter (e.g., "Classes" vs "Files"), leaving a generic placeholder in the empty state (like "Search for classes, symbols, files, text, or endpoints") fails to reinforce the active scope.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state.

## 2024-05-24 - Dynamic Contextual Accessibility Placeholders
**Learning:** Hardcoded accessibility names (like `AutomationProperties.Name="Search query"`) in a unified search bar or components with multiple context filters fail to guide screen reader users. They miss the specific filter context (e.g., "Classes", "Endpoints") that is visible to sighted users via placeholders.
**Action:** Always bind accessibility attributes (such as `AutomationProperties.Name` and `ToolTip`) to the same dynamic properties that drive visual placeholders (e.g., `{Binding SearchPlaceholder}`), ensuring parity between visual and accessible context discoverability.
