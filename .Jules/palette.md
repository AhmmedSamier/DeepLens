## 2026-03-24 - [Watermark TextBlock Z-Index in WPF XAML]

**Learning:** In WPF XAML (e.g., Visual Studio Extension tool windows), elements within the same `Grid` cell render in the order they are declared in the markup. To ensure overlay elements (like an Empty State message or a TextBlock watermark) are visible and not hidden by controls (like a ListBox or TextBox), the overlay must be defined after the background control in the XAML.
**Action:** When adding a watermark `TextBlock` behind a `TextBox` with a transparent background, place the `TextBlock` element *after* the `TextBox` element in the XAML file, and set `IsHitTestVisible="False"` on the `TextBlock` so mouse clicks pass through to the `TextBox`.

## 2026-03-19 - [Accessible Progress Indicators in WPF]

**Learning:** In WPF interfaces, ensure non-interactive progress indicators (like `ProgressBar`) include an `AutomationProperties.Name` attribute so their state and purpose remain accessible to screen readers.
**Action:** Add `AutomationProperties.Name` to `ProgressBar` elements in WPF XAML files to ensure they are accessible.

## 2024-01-01 - [Init]

## 2026-03-09 - [Informational Empty States in QuickPick]

**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled standard items; clicking any item inherently closes the menu or acts as a confusing "dead click." To solve this for purely informational items or empty state headers, we use `kind: vscode.QuickPickItemKind.Separator`. This forces VS Code to render the item as an unselectable header, cleanly preventing unintentional dismissals without side effects.
**Action:** Always use `vscode.QuickPickItemKind.Separator` for empty state headers. We previously considered adding a secondary utility like "Copy to clipboard" for these informational items to give the dead click a purpose, but that approach risks destructively overwriting the user's clipboard during an accidental dismissal. Separators are the correct, native solution.
