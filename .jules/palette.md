## 2024-05-14 - Dynamic AutomationProperties in WPF
**Learning:** In WPF applications with multiple scopes or filters, `AutomationProperties.Name` should be bound to a dynamic property that reacts to the selected filter state, rather than using a generic static string. This ensures screen readers always announce context-aware labels that match the current UI state.
**Action:** Always bind `AutomationProperties.Name` to the same dynamic viewmodel property used for visual tooltips or watermarks to maintain parity between visual and accessible experiences.

## 2026-05-10 - Context-Aware Empty States and Screen Reader Context in WPF
**Learning:** In WPF applications with multiple scopes or filters, using a generic static string (like "No results found" or "Search query") for empty states and screen reader accessibility labels fails to convey the active UI context to the user.
**Action:** Bind the empty state watermark/placeholder (both visual `TextBlock.Text` and accessibility attributes like `TextBox.ToolTip` or `AutomationProperties.Name`) to a dynamic property that reacts to the selected filter state, improving both feature discoverability and screen reader context.

## 2026-05-10 - Enhance CodeLens Visual Hierarchy
**Learning:** Text-only CodeLens annotations (like "3 references (Shift+F12)") can blend into the source code, reducing scannability and visual appeal.
**Action:** Prepend relevant VS Code Codicons (like `$(references)` or `$(symbol-interface)`) to the CodeLens titles to establish visual anchors, improving micro-UX and making the annotations quicker to identify at a glance.
