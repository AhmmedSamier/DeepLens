# Data Model: File Icons in Search Results

**Feature**: File Icons in Search Results
**Status**: Draft

## Core Entities

### SearchResultItem (VS Code Extension View Model)

Extends the standard `vscode.QuickPickItem` to support native file icon rendering.

```typescript
interface SearchResultItem extends vscode.QuickPickItem {
    // EXISTING FIELDS
    label: string;
    description?: string;
    detail?: string;
    
    // NEW FIELD
    /**
     * The URI of the file. 
     * When present, and iconPath is set to ThemeIcon.File, 
     * VS Code renders the native file icon for this resource.
     */
    resourceUri?: vscode.Uri;
    
    // Internal reference
    result: SearchResult;
}
```

### FileIcon (Concept)

Conceptually represents the mapping strategy, though implemented via native API.

| Field | Type | Description |
|-------|------|-------------|
| `resourceUri` | `vscode.Uri` | The file system path converted to a URI. |
| `iconPath` | `vscode.ThemeIcon` | Set to `vscode.ThemeIcon.File` to trigger theme lookup. |

## Data Flow

1. **Search Engine (LS)**: Returns `SearchResult` with `filePath` (string).
2. **LSP Client (Extension)**: Receives `SearchResult`.
3. **Search Provider**: 
   - Converts `filePath` -> `vscode.Uri.file(filePath)`.
   - Assigns to `SearchResultItem.resourceUri`.
   - Sets `SearchResultItem.iconPath = new vscode.ThemeIcon('file')` if `item.type === 'file'`.
   - Passes list to `QuickPick`.

## Schema Changes

No persistent database changes.
No changes to `language-server` core types required.
