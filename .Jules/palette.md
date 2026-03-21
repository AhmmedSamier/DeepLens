## 2025-02-18 - Visual Studio WPF TextBox Placeholder & ProgressBar Accessibility
**Learning:** In Visual Studio Extension tool windows built with WPF, `TextBox` elements lack a built-in `Placeholder` property. Standard UI practices require an overlay `TextBlock` bound to the `TextBox`'s text content to act as a watermark/placeholder for discoverability. Additionally, non-interactive elements like `ProgressBar`s that convey important state (like "Indexing progress") need explicit `AutomationProperties.Name` attributes, otherwise they are completely ignored by screen readers, hiding crucial system state from users. Finally, use `{DynamicResource {x:Static vsshell:VsBrushes.GrayTextKey}}` for placeholder text to ensure it integrates seamlessly with Visual Studio's light and dark themes.
**Action:** Always use an overlaid `TextBlock` with a `DataTrigger` to simulate placeholders in WPF `TextBox`es. Ensure all `ProgressBar`s and status indicators have descriptive `AutomationProperties.Name` set. Use native VS brushes for styling.

## 2024-01-01 - [Init]

## 2026-03-09 - [Informational Empty States in QuickPick]

**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled standard items; clicking any item inherently closes the menu or acts as a confusing "dead click." To solve this for purely informational items or empty state headers, we use `kind: vscode.QuickPickItemKind.Separator`. This forces VS Code to render the item as an unselectable header, cleanly preventing unintentional dismissals without side effects.
**Action:** Always use `vscode.QuickPickItemKind.Separator` for empty state headers. We previously considered adding a secondary utility like "Copy to clipboard" for these informational items to give the dead click a purpose, but that approach risks destructively overwriting the user's clipboard during an accidental dismissal. Separators are the correct, native solution.
