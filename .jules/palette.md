## 2026-05-02 - Actionable Empty States
**Learning:** Empty states present an opportunity to lower user friction when a search yields zero results. Providing a "Clear Search" or "Switch Scope" directly in the empty state acts as an actionable recovery path, so users don't have to manually clear the input field or change settings themselves.
**Action:** When designing or refactoring empty state components, always provide an inline action button (such as "Clear Search", "Reset Filters", or "Back to Global Scope") directly within the empty state context to simplify recovery.
## 2026-05-03 - [Empty State Actionability]
**Learning:** Empty states without actionable elements increase interaction friction. Users shouldn't have to manually clear filters when no results are found.
**Action:** Always provide an actionable recovery path (like a 'Clear Search' button) directly within the empty state container when building UI views.
## 2026-05-05 - [Integrated Quick Pick Search Clear Action]
**Learning:** For empty search states in a VS Code QuickPick dropdown, users encounter friction if they must manually select and delete text to retry. Adding a custom command bound to an icon (like `clear-all`) directly into the `getEmptyStateItems` provides an immediate, discoverable recovery path.
**Action:** Always include an actionable "Clear Input/Search" recovery button within `QuickPick` empty state lists to reduce interaction friction and improve the search UX.

## 2026-05-12 - CodeLens Visual Clarity
**Learning:** CodeLens titles without icons can blend into the text, reducing scannability and discoverability.
**Action:** Use standard VS Code Codicons (e.g., $(call-incoming), $(references)) in CodeLens titles and UI elements to improve visual hierarchy and micro-UX.

## 2026-05-14 - Prioritize Clear Action in Empty State
**Learning:** Having multiple, duplicate actions (like 'Clear Search' and 'Clear Search Query') in an empty state increases cognitive load, and burying the primary recovery action below secondary ones (like 'Switch Scope') increases interaction friction.
**Action:** When designing empty state lists, ensure there is only one clear recovery action, and prioritize it as the very first actionable item directly below the informational header to provide the fastest path forward.

## 2026-05-17 - [Integrated Quick Pick Search Clear Action]
**Learning:** For empty search states in a VS Code QuickPick dropdown, users encounter friction if they must manually select and delete text to retry. Adding a custom command bound to an icon (like `clear-all`) directly into the `getEmptyStateItems` provides an immediate, discoverable recovery path.
**Action:** Always include an actionable "Clear Input/Search" recovery button within `QuickPick` empty state lists to reduce interaction friction and improve the search UX.

## 2026-05-18 - Deduplicating Empty State Actions
**Learning:** Displaying multiple identical or confusingly similar actions (like "Clear Search" and "Clear Search Query") in empty states increases cognitive load. Users hesitate to choose the correct recovery path.
**Action:** When creating empty states, consolidate recovery actions and prioritize the primary recovery method (like `CMD_CLEAR_QUERY`) by placing it directly below the "No results" header, saving the user from scrolling.

## 2026-05-20 - [Actionable Empty State Filter Reset]
**Learning:** In complex search UIs with multiple filters, an empty state "Clear Search" button should not just clear the text query; it must reset all applied filters to their default state to provide a true recovery path.
**Action:** When implementing "Clear Search" functionality, always trace the filter state management and ensure all active filters (e.g., `FilterAll = true`) are reset alongside the text input.

## 2026-05-26 - Add ARIA labels to search filter radio buttons
**Learning:** The filter radio buttons in the Visual Studio extension SearchControl were missing `AutomationProperties.Name`, making them inaccessible to screen readers. Adding them improves accessibility.
**Action:** Always verify that interactive elements like RadioButtons and buttons have `AutomationProperties.Name` in WPF/XAML files for proper a11y support.

## 2026-05-28 - Added ToolTips and AutomationProperties to WPF RadioButton Tabs
**Learning:** When using RadioButtons as styled tabs in WPF/XAML without explicitly visible text context (or when they need better screen reader support), adding `AutomationProperties.Name` provides crucial context for screen readers, and `ToolTip` improves visual discoverability for users navigating the UI.
**Action:** Always verify that interactive elements like custom-styled RadioButtons and buttons have `AutomationProperties.Name` configured for accessibility, and include a `ToolTip` when functioning as tabs or filters.

## 2026-05-29 - Fix UI list auto-selection priority
**Learning:** When auto-selecting an item from a list (e.g., QuickPick) based on priority, using a single `.find(condition A || condition B)` evaluates elements in their rendered array order, effectively ignoring intended fallback priority and simply returning the first matching element found. To enforce strict priority regardless of visual/array order, chained `.find(A) || .find(B)` calls must be used.
**Action:** Always use explicit sequential `.find()` fallback chains when the goal is to prioritize specific actions (like "Clear" > "Switch Scope" > "Native Search") over their presentation order in the UI.

## 2026-05-30 - Centralized Loading Feedback
**Learning:** Relying solely on a small status bar text (like "Searching...") during async operations creates a poor UX, as users may miss the tiny indicator and assume the interface is frozen or broken when the main content area remains blank.
**Action:** When implementing async search or data fetching, always provide clear, central visual feedback (such as a loading spinner or indeterminate progress bar) directly within the main content area.

## 2026-05-30 - Added Loading Feedback to Empty State Actions
**Learning:** Empty state actionable buttons (like Rebuild Index or Clear Cache) execute long-running commands silently, leaving users unsure if their click registered. This is a common pattern in VS Code QuickPick items that execute commands.
**Action:** When executing async commands from a QuickPick, always use `this.showFeedback()` or `vscode.window.showInformationMessage()` *before* calling `quickPick.hide()` to provide immediate visual confirmation.
