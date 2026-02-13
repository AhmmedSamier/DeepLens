# QuickPick Native File Icons Research

## 1. Decision
Use `vscode.ThemeIcon.File` combined with the `resourceUri` property on `QuickPickItem` to render native file icons that match the user's active file icon theme.

## 2. Rationale
- **Native Look & Feel**: This approach uses VS Code's built-in file icon rendering logic, ensuring perfect consistency with the user's active icon theme (e.g., Material Icon Theme, Seti, etc.).
- **Performance**: VS Code handles icon loading and caching efficiently. We don't need to bundle megabytes of SVG icons or manage complex mappings.
- **Maintainability**: No need to maintain a mapping of file extensions to icons. VS Code handles new file types and theme updates automatically.
- **Simplicity**: Implementation requires only adding `resourceUri` and setting `iconPath` to `ThemeIcon.File`.

## 3. Implementation Details
### API Support
- `QuickPickItem.resourceUri` is supported in VS Code 1.67+ (April 2022).
- `vscode.ThemeIcon.File` allows delegating the icon choice to the active theme based on the resource.

### Type Definition Discrepancy
- The `@types/vscode` version `1.85.0` (and even `1.107.0` in strict mode) may not explicitly list `resourceUri` on `QuickPickItem` in the main interface definition, but it is supported by the runtime and present in the internal `vscode.d.ts` used for testing.
- **Solution**: We can explicitly add `resourceUri?: vscode.Uri` to our `SearchResultItem` interface (which extends `QuickPickItem`). The runtime will pick it up.

### Code Changes
1.  Update `SearchResultItem` interface:
    ```typescript
    interface SearchResultItem extends vscode.QuickPickItem {
        result: SearchResult;
        resourceUri?: vscode.Uri; // Add this
    }
    ```
2.  Update `resultToQuickPickItem` method:
    ```typescript
    if (item.type === SearchItemType.FILE) {
        // Use native file icon
        return {
            ...
            resourceUri: vscode.Uri.file(item.filePath),
            iconPath: vscode.ThemeIcon.File,
            ...
        };
    }
    ```

## 4. Alternatives Considered
| Approach | Pros | Cons |
|bound|---|---|
| **vscode-icons-js** | Works on very old VS Code versions | Bloats bundle size; doesn't match user's theme; requires maintenance of icon mappings. |
| **Manual `ThemeIcon` mapping** | Simple for basic types (File, Folder) | No specific icons for extensions (e.g., .ts vs .py); generic 'file' icon is boring. |
| **FileDecoration** | Can overlay badges | Not supported in QuickPick; overly complex. |

## 5. Async Updates
- `QuickPick` does not support fine-grained reactivity. To update an item, the entire `items` array typically needs to be re-assigned.
- However, with `resourceUri`, VS Code handles the icon fetching asynchronously. We do not need to manually trigger updates for icons to appear. They will render as soon as VS Code resolves the theme icon for the URI.
