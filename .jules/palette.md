## 2024-05-24 - Empty States Should Be Actionable
**Learning:** Users often get stuck in empty search states because the path to recovery (clearing text or changing tabs) requires moving focus away from the empty state area.
**Action:** Always provide an actionable recovery path (like a "Clear Search" button) directly within the empty state container to reduce interaction friction.
## 2024-11-20 - Dynamic Accessibility for Multi-Scope Inputs
**Learning:** In multi-scope UI elements (like a unified search bar that filters based on context), static ARIA labels or `AutomationProperties.Name` attributes (e.g., "Search query") fail to convey the current state to screen reader users. The context of *what* is being searched is crucial for accessibility.
**Action:** Always bind the accessibility name (e.g., `AutomationProperties.Name="{Binding SearchPlaceholder}"`) to the dynamic placeholder property rather than a generic static string. This ensures screen readers announce context-aware hints (like "Classes: Try 'UserService'...") when the user switches scopes, and that the screen reader context matches the visual tooltip.
