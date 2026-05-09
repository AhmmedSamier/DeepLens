## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-04-18 - Context-Aware Placeholders in Empty States

**Learning:** In C# WPF applications (and UIs generally), when users select a filter (e.g., "Classes" vs "Files"), leaving a generic placeholder in the empty state (like "Search for classes, symbols, files, text, or endpoints") fails to reinforce the active scope.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state.

## 2024-05-24 - Dynamic Contextual Accessibility Placeholders
**Learning:** Hardcoded accessibility names (like `AutomationProperties.Name="Search query"`) in a unified search bar fail to guide screen reader users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` via accessibility properties drastically improves feature discoverability for all users.
**Action:** When a UI component manages multiple scopes or filters, ensure the empty state watermark/placeholder is synchronized with accessibility properties (like `AutomationProperties.Name`) using dynamic bindings (e.g., `{Binding SearchPlaceholder}`), rather than using generic static strings.

## 2025-02-09 - Dynamic Accessible Name for Contextual Search Input
**Learning:** Hardcoding accessibility names (like `AutomationProperties.Name="Search query"`) in components with multiple context filters creates a generic experience that ignores the current UI state. Users navigating with screen readers miss out on the specific filter context (e.g., "Classes", "Endpoints") that is visible to sighted users via placeholders.
**Action:** Always bind accessibility attributes (such as `AutomationProperties.Name` and `ToolTip`) to the same dynamic properties that drive visual placeholders, ensuring parity between visual and accessible context discoverability.
