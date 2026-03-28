## 2026-03-28 - [Contextual QuickPick Actions]

**Learning:** In VS Code QuickPicks, adding many inline buttons to every item causes severe visual clutter and drastically impairs keyboard navigation by inserting numerous tab stops per row. Actions should be strictly contextual based on the item type (e.g., 'Copy Reference' for code symbols only, 'Reveal in File Explorer' for files only).
**Action:** When mapping search results to `vscode.QuickPickItem` objects, conditionally apply action buttons using `item.type` to ensure users only see relevant UI actions, reducing cognitive load and tab stops.

## 2026-03-19 - [Accessible Progress Indicators in WPF]

**Learning:** In WPF interfaces, ensure non-interactive progress indicators (like `ProgressBar`) include an `AutomationProperties.Name` attribute so their state and purpose remain accessible to screen readers.
**Action:** Add `AutomationProperties.Name` to `ProgressBar` elements in WPF XAML files to ensure they are accessible.

## 2024-01-01 - [Init]

## 2026-03-09 - [Informational Empty States in QuickPick]

**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled standard items; clicking any item inherently closes the menu or acts as a confusing "dead click." To solve this for purely informational items or empty state headers, we use `kind: vscode.QuickPickItemKind.Separator`. This forces VS Code to render the item as an unselectable header, cleanly preventing unintentional dismissals without side effects.
**Action:** Always use `vscode.QuickPickItemKind.Separator` for empty state headers. We previously considered adding a secondary utility like "Copy to clipboard" for these informational items to give the dead click a purpose, but that approach risks destructively overwriting the user's clipboard during an accidental dismissal. Separators are the correct, native solution.
