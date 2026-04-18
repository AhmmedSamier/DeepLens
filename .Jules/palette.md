## 2024-04-06 - Infinite Loading Spinner on Empty Search
**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.
## 2024-05-24 - Dynamic Contextual Search Placeholders
**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.
## 2024-05-24 - Dynamic Contextual Accessibility Placeholders
**Learning:** Hardcoded accessibility names (like `AutomationProperties.Name="Search query"`) in a unified search bar fail to guide screen reader users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` via accessibility properties drastically improves feature discoverability for all users.
**Action:** When a UI component manages multiple scopes or filters, ensure the empty state watermark/placeholder is synchronized with accessibility properties (like `AutomationProperties.Name`) using dynamic bindings (e.g., `{Binding SearchPlaceholder}`), rather than using generic static strings.
