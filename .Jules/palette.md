## 2024-01-01 - [Init]
## 2026-03-09 - [Empty State Dead Clicks in QuickPick]
**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled items; clicking any item inherently closes the menu or acts as a dead click. To prevent confusing dead clicks for informational items (e.g., status/stats displays or empty states), provide a secondary utility like 'Copy to clipboard'.
**Action:** Implement 'Copy to clipboard' functionality and label it in the description field for informational items to ensure they provide value and prevent user confusion.
## 2026-03-09 - [Informational Empty States in QuickPick]
**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled items; clicking any item inherently closes the menu or acts as a dead click. To prevent confusing dead clicks for informational items (e.g., status/stats displays or empty states), use `kind: vscode.QuickPickItemKind.Separator`.
**Action:** Use `vscode.QuickPickItemKind.Separator` for empty state headers or purely informational items so they naturally render as unselectable headers without side effects.
