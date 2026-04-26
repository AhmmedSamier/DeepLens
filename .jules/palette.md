## 2024-05-14 - Dynamic AutomationProperties in WPF
**Learning:** In WPF applications with multiple scopes or filters, `AutomationProperties.Name` should be bound to a dynamic property that reacts to the selected filter state, rather than using a generic static string. This ensures screen readers always announce context-aware labels that match the current UI state.
**Action:** Always bind `AutomationProperties.Name` to the same dynamic viewmodel property used for visual tooltips or watermarks to maintain parity between visual and accessible experiences.
