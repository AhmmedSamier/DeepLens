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

## 2026-06-01 - Inline QuickPick Button Feedback
**Learning:** Inline QuickPick item buttons (like Rebuild Index or Clear Cache) execute async commands silently, leaving users unsure if their click registered, similar to empty state actions.
**Action:** When executing async commands from inline QuickPick item buttons, always use `this.showFeedback()` or `vscode.window.showInformationMessage()` *before* calling `quickPick.hide()` to provide immediate visual confirmation.

## 2026-06-04 - Reset Filters on Clear Search in VS Code QuickPick
**Learning:** In complex search UIs with multiple filters, an empty state "Clear Search" action that only clears the text query leaves users stuck in a filtered state they might not realize they're in. This increases cognitive load and friction.
**Action:** When implementing "Clear Search" functionality, always ensure all active filters and scopes are reset alongside the text input, and update the UI feedback to clearly communicate the complete reset.

## 2026-06-05 - Actionable Empty State with .textContent
**Learning:** When generating actionable empty states dynamically in webviews (e.g., "No results for X"), using `.innerHTML` with a custom escape function risks `ReferenceError` crashes if the escape function isn't perfectly bundled. It also exposes a theoretical XSS vector.
**Action:** Always use native DOM methods like `document.createElement` and `.textContent` when injecting user input into webviews to ensure robust, built-in XSS protection and zero dependency on custom escape utilities.

## 2026-06-12 - Add ARIA pressed state to search scope buttons
**Learning:** Toggle buttons that visually indicate active state (like filter scope buttons) must communicate this state programmatically to screen readers. Relying solely on a visual class like '.active' leaves screen reader users unaware of which filter is currently selected.
**Action:** Always add `aria-pressed="true/false"` to toggleable filter buttons and update this attribute dynamically alongside any visual class changes to ensure proper keyboard and screen reader accessibility.

## 2024-06-14 - Empty States Should Not Present Recovery Actions for Empty Inputs
**Learning:** Presenting recovery actions (like "Clear Search" or "Switch Scope") when a user simply hasn't typed anything yet is confusing. The empty state when an input is completely blank should simply guide the user to begin (e.g. "Enter a search query to get started."), and only show actionable recovery paths when an actual search yielded zero results.
**Action:** When creating empty states, always check if the input query is empty. If it is, display a welcoming or instructional message and hide recovery actions.

## 2026-06-13 - Added proper ARIA attributes to group filter toggles
**Learning:** Found that custom filter buttons acting as a radio-group/toggles lacked accessibility support for screen readers. Using just class names for visual toggling isn't enough; we need `role="group"` to define the collection and `aria-pressed` to communicate state changes to assistive technologies.
**Action:** Always pair visual active classes with dynamic `aria-pressed` updates on custom toggleable elements, and group them correctly.

## 2026-06-27 - Educational Empty States
**Learning:** Empty states for complex search interfaces are valuable opportunities to educate users on advanced query syntax (like slash commands) through interactive pro tips, rather than just displaying static 'Enter a query' text.
**Action:** When designing search or command inputs, leverage the initial empty state to provide clickable examples that instantly demonstrate platform capabilities.

## 2026-06-19 - Loading Indication for Webview Async Ops
**Learning:** Relying purely on top-bar notification status messages is insufficient for async operations inside of Webviews. A central progress bar enhances UX by reassuring users that background activity (e.g., searches, clearing history) is occurring.
**Action:** Use native VS Code CSS variables like `--vscode-progressBar-background` and `visibility: hidden` for central loading bars in Webviews to maintain layout consistency without visual jank.

## 2026-06-16 - Empty States Should Not Present Recovery Actions for Empty Inputs
**Learning:** Reinforced existing rule from 2024-06-14 after QuickPick implementation updates.
**Action:** Keep the existing canonical rule and reference it instead of duplicating full text.

## 2026-06-16 - Centralized Progress Bar Loading Feedback
**Learning:** Relying solely on small status bar updates or having no loading indicator during debounced search operations creates an unresponsive UX, as users assume the interface is frozen while waiting for the debounced search to finish.
**Action:** When adding loading indicators (e.g., progress bars) to VS Code Webviews, apply the built-in `--vscode-progressBar-background` CSS variable for native styling, and use `visibility: hidden` rather than `display: none` to reserve the element's layout space and prevent visual jank when toggling states.

## 2026-06-20 - Webview Indeterminate Progress Bar
**Learning:** Implementing visual feedback (like a progress bar) in webviews across asynchronous IPC boundaries is necessary for smooth UX. By tying it to the start of a user action (e.g., input event, button click) and hiding it upon receiving a response message, the interface stays responsive. However, doing so dynamically using CSS variables `--vscode-progressBar-background` and `visibility: hidden` rather than `display: none` guarantees consistent native VSCode styling while eliminating layout shift during loading.
**Action:** When implementing indeterminate loading indicators in VS Code webviews, apply `--vscode-progressBar-background` for native theming, and use `visibility: hidden`/`visible` instead of `display` or DOM insertion/removal to prevent visual jitter.

## 2026-06-25 - Progress Bar Loader in VS Code Webviews
**Learning:** Progress bar loaders in VS Code Webviews should use `visibility: hidden` instead of `display: none` to reserve layout space and prevent visual jank, and should be paired with `aria-hidden="true"` when an `aria-live` region announces the actual state.
**Action:** Use native CSS variables for styling and ensure accessibility support for loading indicators.

## 2026-07-01 - Prevent Focus Stealing in Search Filter Buttons
**Learning:** In hybrid mouse/keyboard search interfaces (like VS Code Webviews), clicking interactive elements like filter buttons steals DOM focus from the primary search input. This forces users to manually click back into the input or hit Tab before they can resume typing.
**Action:** When implementing filter or scope toggle buttons that don't need their own text-input focus, attach a `mousedown` event listener that calls `e.preventDefault()`. This prevents the browser's default focus transition before it even fires, ensuring the user's cursor remains firmly anchored in the main search input.

## 2026-07-26 - ARIA Combobox for Webview Search Inputs
**Learning:** For a search input that filters a dynamic list of results to be accessible, it needs the ARIA Combobox pattern. Without `role="combobox"`, `aria-activedescendant`, `role="listbox"`, and `role="option"`, screen readers will not announce the currently highlighted result as the user navigates with arrow keys.
**Action:** When implementing custom arrow-key navigation in a search webview, always use the complete ARIA Combobox pattern: apply `role="combobox"` and `aria-activedescendant` to the input, pair it with a `role="listbox"`, give each item `role="option"` with a unique ID, and dynamically update `aria-expanded` and `aria-activedescendant`.
