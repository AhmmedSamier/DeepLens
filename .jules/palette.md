
## 2024-11-20 - Dynamic Accessibility for Multi-Scope Inputs
**Learning:** In multi-scope UI elements (like a unified search bar that filters based on context), static ARIA labels or `AutomationProperties.Name` attributes (e.g., "Search query") fail to convey the current state to screen reader users. The context of *what* is being searched is crucial for accessibility.
**Action:** Always bind the accessibility name (e.g., `AutomationProperties.Name` in WPF/XAML) to the dynamic placeholder property rather than a generic static string. This ensures screen readers announce context-aware hints (like "Classes: Try 'UserService'...") when the user switches scopes.
