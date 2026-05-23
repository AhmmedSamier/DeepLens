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
## 2025-05-23 - Strict array `.find()` priority behavior
**Learning:** When prioritizing items in an auto-selection array (like VS Code QuickPick items), using `Array.prototype.find` with internal `OR` conditions (`find(i => i.id === A || i.id === B)`) incorrectly returns the first matched item in the *array order*, completely ignoring the intended condition priority. This creates unpredictable UI behaviors where lower-priority but alphabetically earlier actions might be incorrectly auto-selected.
**Action:** To enforce strict priority auto-selection, chain individual `.find()` calls using the logical OR operator: `find(i => i.id === A) || find(i => i.id === B)`. This ensures highest priority fallbacks are evaluated first regardless of array order.
