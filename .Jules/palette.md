## 2024-04-06 - Infinite Loading Spinner on Empty Search

**Learning:** When clearing the VS Code QuickPick input, if `quickPick.busy` is true from a previous pending search phase, it will spin indefinitely unless explicitly disabled since empty search queries simply clear results array and exit early.
**Action:** When handling early returns for empty search states or error states in a QuickPick workflow, always explicitly reset `quickPick.busy = false` to prevent confusing infinite loading states.

## 2024-05-18 - Dynamic Placeholders in WPF Search Controls

**Learning:** In WPF applications with multiple scopes or filters (like DeepLens Search Everywhere), using a generic static placeholder string (e.g., "Search for classes, symbols...") fails to inform the user about their currently selected filter scope.
**Action:** Bind the empty state watermark/placeholder (both `TextBox.ToolTip`/`AutomationProperties.Name` and the visual `TextBlock.Text`) to a dynamic string property that computes a contextual placeholder based on the currently active filter, improving feature discoverability and screen reader context.

## 2026-04-10 - Dynamic Search Placeholders based on Filter Context

**Learning:** When dealing with multiple search scopes in a single search box UI (like Visual Studio tool windows), providing static placeholder text ('Search for classes, symbols, files...') is a missed opportunity. Users may not realize the scope has narrowed or what to query for next.
**Action:** Bind the empty state placeholder text to a dynamic property that reacts to the selected filter state, serving tailored examples to improve feature discoverability.

## 2024-05-24 - Dynamic Contextual Search Placeholders

**Learning:** Hardcoded placeholders in a unified search bar fail to guide users when they switch specific context filters. Providing context-aware search query suggestions directly inside the empty `TextBox` watermark drastically improves feature discoverability.
**Action:** When a UI component manages multiple scopes or filters, bind its empty state watermark/placeholder to a dynamic property that reacts to the selected filter state, rather than using a generic static string.
