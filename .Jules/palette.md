## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2024-05-24 - Dynamic Contextual Search Placeholders
**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.
## 2024-05-24 - Dynamic Contextual Search Placeholders Accessibility
**Learning:** We recently made the `TextBox` watermark/placeholder dynamic. However, if the screen-reader specific `AutomationProperties.Name` remains hardcoded (e.g., "Search query"), visually impaired users do not benefit from the contextual hints provided by the new dynamic placeholder.
**Action:** When binding a visual placeholder (`TextBlock.Text` or `TextBox.ToolTip`) to a dynamic view-model property, always ensure that corresponding accessibility attributes like `AutomationProperties.Name` are bound to the exact same dynamic property.
