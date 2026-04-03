## 2026-03-28 - [Contextual QuickPick Actions]

**Learning:** In VS Code QuickPicks, adding many inline buttons to every item causes severe visual clutter and drastically impairs keyboard navigation by inserting numerous tab stops per row. Actions should be strictly contextual based on the item type (e.g., 'Copy Reference' for code symbols only, 'Reveal in File Explorer' for files only).
**Action:** When mapping search results to `vscode.QuickPickItem` objects, conditionally apply action buttons using `item.type` to ensure users only see relevant UI actions, reducing cognitive load and tab stops.

## 2026-03-24 - [Avoid Double Splits in String Case Conversion]

**Learning:** When both original and lowercased string segments are needed, the intuitive approach of splitting the lowercased string (`str.toLowerCase().split('/')`) incurs overhead due to duplicating the string allocation and executing a second array splitting operation. Splitting the original string once and mapping the segments via a manual `for` loop and a pre-allocated array (`new Array()`) is ~35% faster. Although splitting a pre-lowercased string is faster than using `.map()` on the segments, using a pre-allocated array avoids the second iteration entirely.
**Action:** When deriving variations (like lowercased versions) of string segments, split the string once and use a manual `for` loop with a pre-allocated array to generate the derived segments, explicitly disabling the `sonarjs/array-constructor` lint rule.

## 2026-03-25 - [Fast Single Pass Splitting Over Chained/Double Splitting]

**Learning:** When both original and derived (e.g., lowercased) segments are needed from a string, avoiding double splitting (`str.split('/')` and `str.toLowerCase().split('/')`) or `.map()` yields significant performance gains. Splitting the string once and populating a pre-allocated derived array (`new Array(length)`) via a manual `for` loop is ~35-40% faster in hot paths.
**Action:** When both original string segments and lowercased segments are required, split the original string once and use a manual `for` loop with a pre-allocated array (`new Array(length)`) to generate the derived segments, which is ~35% faster.

## 2026-03-22 - [Avoid Chained Array Map when Initializing Set]

**Learning:** When creating a `Set` of unique properties from an array (e.g., `new Set(results.map((r) => r.item.id))`), using `.map()` creates a completely unnecessary intermediate array allocation that is immediately discarded. Replacing this with an empty `Set` initialization and a manual `for` loop to add items avoids this allocation, significantly improving performance and reducing memory churn in hot paths.
**Action:** Always initialize a `Set` directly and use a manual loop instead of chained `.map()` operations when extracting unique properties from an object array.

## 2026-03-20 - [WPF TextBox Watermark Accessibility]

**Learning:** In WPF interfaces, when layering a `TextBlock` over a `TextBox` to simulate a missing placeholder property, explicitly setting `AutomationProperties.Name=""` on the watermark is an anti-pattern. It improperly obscures the element from screen readers.
**Action:** Omit the `AutomationProperties.Name` property entirely on overlay watermarks to allow screen readers to fall back to the `Text` property naturally.

## 2026-03-19 - [Accessible Progress Indicators in WPF]

**Learning:** In WPF interfaces, ensure non-interactive progress indicators (like `ProgressBar`) include an `AutomationProperties.Name` attribute so their state and purpose remain accessible to screen readers.
**Action:** Add `AutomationProperties.Name` to `ProgressBar` elements in WPF XAML files to ensure they are accessible.

## 2026-03-09 - [Informational Empty States in QuickPick]

**Learning:** VS Code QuickPick lists do not support purely non-interactive, disabled standard items; clicking any item inherently closes the menu or acts as a confusing "dead click." To solve this for purely informational items or empty state headers, we use `kind: vscode.QuickPickItemKind.Separator`. This forces VS Code to render the item as an unselectable header, cleanly preventing unintentional dismissals without side effects.
**Action:** Always use `vscode.QuickPickItemKind.Separator` for empty state headers. We previously considered adding a secondary utility like "Copy to clipboard" for these informational items to give the dead click a purpose, but that approach risks destructively overwriting the user's clipboard during an accidental dismissal. Separators are the correct, native solution.

## 2024-05-22 - [Reduce QuickPick Inline Buttons for Accessibility]

**Learning:** Adding too many inline action buttons to every `vscode.QuickPickItem` impairs keyboard navigation by creating excessive tab stops. Users relying on keyboards have to tab through every button on every item to reach the next part of the UI.
**Action:** Conditionally apply inline buttons based on the item's `SearchItemType` (e.g., showing 'Copy Reference' only for code symbols) to reduce tab stops and maintain contextual relevance.

## 2026-03-22 - [WPF TextBox Watermark Visibility]

**Learning:** In WPF tool windows, creating a new `IValueConverter` C# file just to invert visibility for a placeholder watermark is unnecessary and can cause build issues if the `.csproj` file is not updated. A safer, zero-risk approach for a micro-UX improvement is to use pure XAML with a `DataTrigger` on the `TextBlock.Style` to toggle `Visibility` based on the `TextBox.Text.IsEmpty` or `Text.Length`. Also, avoid hardcoding `FontSize` in VS extensions; rely on inherited sizes or theme sizes where possible.
**Action:** Use pure XAML `DataTrigger`s for simple UI state toggles instead of creating new C# converter files. Avoid hardcoding `FontSize`.

## 2026-03-22 - [WPF TextBox Watermark Consistency]

**Learning:** In WPF tool windows, when adding an overlay like a placeholder or watermark to a `TextBox`, bind properties like `FontSize` or `FontFamily` directly to the underlying `TextBox` (e.g., `FontSize="{Binding FontSize, ElementName=SearchTextBox}"`). This ensures consistent visual rendering and avoids visual mismatches if the environment or user settings change the base control's font size.
**Action:** Bind font and alignment properties of watermarks directly to their underlying input controls instead of hardcoding matching values.

## 2024-05-15 - [WPF XAML Watermark Rendering and Overlap Issues]

**Learning:** In WPF tool windows (e.g., Visual Studio Extension), setting up input watermarks involves correctly ordering overlay elements. Elements within the same `Grid` cell render in the exact order they are declared in the markup. Therefore, overlay elements like Empty State messages or TextBlock watermarks must be defined _after_ the primary background control (like a TextBox) in the XAML markup to ensure they render visibly on top. Additionally, multiple overlaid TextBlocks with identical anti-aliasing can cause blurry rendering or invalid markup conflicts, which need to be consolidated. Finally, explicitly setting `AutomationProperties.Name=""` (empty) is an anti-pattern as it obscures the actual textual content from screen readers.
**Action:** When implementing placeholder or watermark text patterns in Visual Studio Extension controls, consolidate multiple duplicated watermark labels, explicitly position the `TextBlock` overlay after the background `TextBox` within the `Grid`, and omit `AutomationProperties.Name` entirely so screen readers correctly read the underlying `Text` property.

## 2026-03-20 - [WPF TextBox Watermark Behavior]

**Learning:** In WPF tool windows, when adding an overlay like a placeholder or watermark to a `TextBox`, avoid hardcoding `Opacity` values on the watermark. Instead, bind `Opacity` directly to the underlying `TextBox` (e.g., `Opacity="{Binding Opacity, ElementName=SearchTextBox, Converter={x:Static local:OpacityConverter.Instance}"}`) to ensure consistent visual rendering and avoid visual mismatches if the environment or user settings change the base control's opacity.
**Action:** Bind opacity of watermarks directly to their underlying input controls instead of hardcoding matching values.

## 2026-03-09 - [WPF Tool Window Title Accessibility]

**Learning:** In WPF tool windows, when adding an overlay like a placeholder or watermark to a `TextBox`, avoid hardcoding `FontSize` or `FontFamily` to match the underlying control. Instead, bind these properties directly to the underlying `TextBox` (e.g., `FontSize="{Binding FontSize, ElementName=SearchTextBox}"`). This ensures consistent visual rendering and avoids visual mismatches if the environment or user settings change the base control's font size.
**Action:** Bind font and alignment properties of watermarks directly to their underlying input controls instead of hardcoding matching values.

## 2024-05-18 - Consolidate WPF Overlapping Watermarks

**Learning:** In WPF XAML, overlapping multiple identical TextBlock elements (like redundant watermarks) causes blurry text rendering due to overlapping anti-aliasing passes. Also, replacing a DataTrigger binding from "Text.Length" against "0" to directly bind to "Text" and checking against an empty string ("") is safer and standard practice in WPF.
**Action:** When implementing overlays or watermarks in WPF applications, consolidate duplicate elements into a single overlay and bind visibility triggers directly to the `Text` dependency property against an empty string to avoid blurry text and ensure robust evaluation.

## 2026-03-30 - [WPF TextBlock Watermark Font Binding]
**Learning:** In WPF XAML tool windows, when using a `TextBlock` as a watermark for a `TextBox`, avoid hardcoding font sizes (e.g., `FontSize="14"`). Doing so prevents the placeholder text from scaling when a user modifies their environment font size or accessibility settings.
**Action:** Instead of hardcoding, bind the `FontSize` property of the watermark directly to the underlying input control using `FontSize="{Binding FontSize, ElementName=SearchTextBox}"` so it scales correctly with user preferences.
