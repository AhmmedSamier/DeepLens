## 2026-01-23 - [Fragile Tooltip Matching]
**Learning:** `vscode.QuickInputButton` does not have an ID, forcing event listeners to match by `tooltip` string. This led to a bug where the listener checked for "Rebuild Index" but the button tooltip was "Rebuild Index (Fix missing files)".
**Action:** Always define button tooltips as class constants (e.g., `private readonly TOOLTIP_REBUILD`) and use these constants in both button creation and event matching to prevent mismatches.

## 2026-01-23 - [Empty State Discovery]
**Learning:** Empty history states in search interfaces are a wasted opportunity. Instead of showing a blank list, presenting "Quick Start" or "Welcome" items helps users discover features (like filter commands) that are otherwise hidden.
**Action:** Populate empty history/initial states with clickable "Tips" or "Command Shortcuts" that guide the user on how to use the tool.
