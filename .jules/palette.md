## 2024-04-29 - Dynamic Accessibility Names for WPF TextBoxes
**Learning:** In WPF tool windows with multiple search scopes or filters, using generic static strings for `AutomationProperties.Name` (e.g., "Search query") deprives screen reader users of important context about the current search state.
**Action:** Bind the accessibility name to a dynamic property that reacts to the selected filter state (e.g., `AutomationProperties.Name="{Binding SearchPlaceholder}"`), ensuring the screen reader context matches the visual tooltip and provides specific, helpful guidance.
