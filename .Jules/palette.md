## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-05-24 - Dynamic Contextual Search Placeholders

**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.

## 2024-05-24 - Dynamic Contextual Search Placeholders Accessibility

**Learning:** We recently made the `TextBox` watermark/placeholder dynamic. However, if the screen-reader specific `AutomationProperties.Name` remains hardcoded (e.g., "Search query"), visually impaired users do not benefit from the contextual hints provided by the new dynamic placeholder.
**Action:** When binding a visual placeholder (`TextBlock.Text` or `TextBox.ToolTip`) to a dynamic view-model property, always ensure that corresponding accessibility attributes like `AutomationProperties.Name` are bound to the exact same dynamic property.

## 2024-06-11 - Persisting Context Defaults

**Learning:** Forcing a user to re-select a specific search scope (like `/m` for modified files) every time they open a search dialog creates friction.
**Action:** Use `vscode.Memento` to persist user scope selections across sessions. Centralize the state update in a setter to guarantee synchronization between in-memory values and persistent storage across all UI interaction points.

## 2024-04-18 - Context-Aware Placeholders in Empty States

**Learning:** In C# WPF applications (and UIs generally), when users select a filter (e.g., "Classes" vs "Files"), leaving a generic placeholder in the empty state (like "Search for classes, symbols, files, text, or endpoints") fails to reinforce the active scope.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state.

## 2024-05-24 - Dynamic Contextual Accessibility Placeholders

**Learning:** Hardcoded accessibility names (like `AutomationProperties.Name="Search query"`) in a unified search bar or components with multiple context filters fail to guide screen reader users. They miss the specific filter context (e.g., "Classes", "Endpoints") that is visible to sighted users via placeholders.
**Action:** Always bind accessibility attributes (such as `AutomationProperties.Name` and `ToolTip`) to the same dynamic properties that drive visual placeholders (e.g., `{Binding SearchPlaceholder}`), ensuring parity between visual and accessible context discoverability.
