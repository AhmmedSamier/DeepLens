## 2026-05-10 - Context-Aware Empty States and Screen Reader Context in WPF
**Learning:** In WPF applications with multiple scopes or filters, using a generic static string (like "No results found" or "Search query") for empty states and screen reader accessibility labels fails to convey the active UI context to the user.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state, improving both feature discoverability and screen reader context.
## 2026-05-10 - Enhance CodeLens Visual Hierarchy
**Learning:** Text-only CodeLens annotations (like "3 references (Shift+F12)") can blend into the source code, reducing scannability and visual appeal.
**Action:** Prepend relevant VS Code Codicons (like `$(references)` or `$(symbol-interface)`) to the CodeLens titles to establish visual anchors, improving micro-UX and making the annotations quicker to identify at a glance.
## 2024-05-11 - Empty State Recovery Action
**Learning:** Adding a direct, primary recovery action ("Clear Search") directly into the empty state container significantly reduces user friction. When a search yields no results, users don't have to manually delete characters in the input field to escape the empty state.
**Action:** When designing or refactoring UI components with an empty state (e.g., filtered lists, search results), ensure the empty state itself provides an immediate, one-click mechanism to clear filters or reset the view.
