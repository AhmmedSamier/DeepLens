## 2024-02-13 - Auto-select recovery action on empty search
**Learning:** When a search returns no results, users often want to try a broader search or a different tool immediately. Auto-selecting the "Switch Scope" or "Native Search" action reduces friction significantly by allowing them to just press Enter, instead of navigating down the list.
**Action:** For empty states in QuickPicks, identify the primary recovery action and set `activeItems` to pre-select it, while keeping the "No results" message visible but passive.

## 2024-02-14 - Direct manipulation in search history
**Learning:** Users often have "polluted" search history (e.g., opened a wrong file) and want to clean it up without wiping everything. Adding a direct "Remove" action on individual history items empowers users to curate their workspace context.
**Action:** When displaying recent history or suggestion lists, consider adding granular management actions (like remove/delete) directly on the items via `QuickInputButton`.

## 2025-02-15 - Inline examples for slash commands
**Learning:** Slash commands can be abstract. Showing a concrete example inline (e.g., "Try: /t User") significantly reduces the cognitive load of remembering syntax.
**Action:** Check for unused metadata in command definitions (like 'example' or 'usage') and expose it in the UI description/detail fields.

## 2025-02-16 - Symbol-based shortcuts reduce clutter
**Learning:** Formatting keyboard shortcuts with platform-specific symbols (e.g., ⌃⇧T instead of Ctrl+Shift+T) makes command palettes much easier to scan and looks more native on macOS, while maintaining text clarity on Windows/Linux is safer.
**Action:** Use a utility to detect platform and format keybindings appropriately in UI labels.
