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
