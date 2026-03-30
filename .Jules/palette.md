## 2026-03-19 - [Accessible Progress Indicators in WPF]

**Learning:** In WPF interfaces, ensure non-interactive progress indicators (like `ProgressBar`) include an `AutomationProperties.Name` attribute so their state and purpose remain accessible to screen readers.
**Action:** Add `AutomationProperties.Name` to `ProgressBar` elements in WPF XAML files to ensure they are accessible.

## 2024-01-01 - [Init]

## 2026-03-09 - [Informational Empty States in QuickPick]

**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled standard items; clicking any item inherently closes the menu or acts as a confusing "dead click." To solve this for purely informational items or empty state headers, we use `kind: vscode.QuickPickItemKind.Separator`. This forces VS Code to render the item as an unselectable header, cleanly preventing unintentional dismissals without side effects.
**Action:** Always use `vscode.QuickPickItemKind.Separator` for empty state headers. We previously considered adding a secondary utility like "Copy to clipboard" for these informational items to give the dead click a purpose, but that approach risks destructively overwriting the user's clipboard during an accidental dismissal. Separators are the correct, native solution.

## 2026-03-22 - [WPF TextBox Watermark Visibility]
**Learning:** In WPF tool windows, creating a new `IValueConverter` C# file just to invert visibility for a placeholder watermark is unnecessary and can cause build issues if the `.csproj` file is not updated. A safer, zero-risk approach for a micro-UX improvement is to use pure XAML with a `DataTrigger` on the `TextBlock.Style` to toggle `Visibility` based on the `TextBox.Text.IsEmpty` or `Text.Length`. Also, avoid hardcoding `FontSize` in VS extensions; rely on inherited sizes or theme sizes where possible.
**Action:** Use pure XAML `DataTrigger`s for simple UI state toggles instead of creating new C# converter files. Avoid hardcoding `FontSize`.

## 2026-03-22 - [WPF TextBox Watermark Consistency]
**Learning:** In WPF tool windows, when adding an overlay like a placeholder or watermark to a `TextBox`, bind properties like `FontSize` or `FontFamily` directly to the underlying `TextBox` (e.g., `FontSize="{Binding FontSize, ElementName=SearchTextBox}"`). This ensures consistent visual rendering and avoids visual mismatches if the environment or user settings change the base control's font size.
**Action:** Bind font and alignment properties of watermarks directly to their underlying input controls instead of hardcoding matching values.
