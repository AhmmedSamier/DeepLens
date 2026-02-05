## 2026-01-23 - [Fragile Tooltip Matching]
**Learning:** `vscode.QuickInputButton` does not have an ID, forcing event listeners to match by `tooltip` string. This led to a bug where the listener checked for "Rebuild Index" but the button tooltip was "Rebuild Index (Fix missing files)".
**Action:** Always define button tooltips as class constants (e.g., `private readonly TOOLTIP_REBUILD`) and use these constants in both button creation and event matching to prevent mismatches.

## 2026-01-23 - [Empty State Discovery]
**Learning:** Empty history states in search interfaces are a wasted opportunity. Instead of showing a blank list, presenting "Quick Start" or "Welcome" items helps users discover features (like filter commands) that are otherwise hidden.
**Action:** Populate empty history/initial states with clickable "Tips" or "Command Shortcuts" that guide the user on how to use the tool.

## 2026-01-25 - [Actionable Empty States]
**Learning:** When a scoped search returns no results, passive advice (e.g., "Try /all") is less effective than providing a direct action. Users prefer a one-click "Search Everywhere" button inside the empty state item over re-typing commands or finding filter buttons.
**Action:** In empty states caused by filters, always inject an interactive `QuickInputButton` that clears the filter and immediately re-triggers the search.

## 2026-01-26 - [Manual Highlighting in QuickPick]
**Learning:** When using `alwaysShow: true` to bypass VS Code's internal filtering, we also lose the native match highlighting. This creates a disconnect where users see results but not *why* they matched.
**Action:** Use `fuzzysort` or similar to manually calculate match indices and provide them via `QuickPickItemLabel` to restore visual feedback.

## 2026-01-26 - [Unsaved Changes Indicator]
**Learning:** `QuickPickItem` does not support custom highlights via `label` object in this API version, nor does `alwaysShow: true` allow native highlighting. This creates a need for alternative visual cues.
**Action:** Instead of highlights, added a `` indicator to the `description` of open, dirty files to provide valuable context without breaking the UI constraints.

## 2026-01-26 - [Unsaved Changes Indicator]
**Learning:** QuickPickItem does not support custom highlights via label object in this API version, nor does alwaysShow allow native highlighting. This creates a need for alternative visual cues.
**Action:** Instead of highlights, added a $(circle-filled) indicator to the description of open, dirty files to provide valuable context without breaking the UI constraints.

## 2026-02-04 - [QuickPickItemLabel Type Mismatch]
**Learning:** The `@types/vscode` package (even recent versions) may not reflect all runtime capabilities, such as `QuickPickItem.label` accepting a `QuickPickItemLabel` object (introduced in 1.76) instead of just a string.
**Action:** When targeting a VS Code version that supports a feature (verified via release notes) but types are missing, use type casting (e.g., `label as any`) to leverage the feature without TypeScript errors, ensuring the `engines` field in `package.json` enforces the minimum runtime requirement.

## 2025-05-23 - [Action Button Clutter]
**Learning:** Universal action buttons (like 'Copy Path') cause confusion on abstract items like Commands. Users hesitate when UI affordances (like 'Reveal in Explorer') contradict the item's nature.
**Action:** Conditionally render action buttons based on `SearchItemType`. Only show file-related actions for file-backed items.

## 2025-05-27 - [Context-Aware Empty States]
**Learning:** Suggesting actions the user has already taken (e.g., "Try /all" when already in Global scope) frustrates users and erodes trust.
**Action:** Ensure empty state messages are context-aware. If the scope is already global, suggest deeper debugging steps like checking exclusions or rebuilding the index.

<<<<<<< palette-clear-history-8215570654435959424
## 2026-05-28 - [In-List History Management]
**Learning:** Users hesitate to leave a workflow (like search) to manage its settings (like clearing history). Placing management actions directly within the list content (e.g., as the last item) maintains flow.
**Action:** When displaying history or recent items, append a "Clear History" action item directly to the list, allowing immediate maintenance without context switching.
=======
## 2026-02-05 - [In-Context Feedback]
**Learning:** Status bar messages (`window.setStatusBarMessage`) are often missed by users when their attention is focused on a specific UI element like a QuickPick item.
**Action:** Use the `QuickPick.title` or placeholder to flash temporary feedback (e.g., "Copied! ✅") directly within the component the user is interacting with, then revert to the original state.
>>>>>>> master

## 2025-02-05 - In-Place Confirmation in QuickPick
**Learning:** When adding destructive actions to a VS Code QuickPick (like "Clear History"), replacing the items with a "Confirm/Cancel" set is a smoother pattern than popping a modal dialog, which breaks the keyboard flow.
**Action:** Use `quickPick.items` replacement for simple confirmations within the search interface.
