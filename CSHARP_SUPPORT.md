# C# Support for Find Everywhere

## Requirements

To search C# files, you need:

1. **C# Dev Kit Extension** (or **C# extension**)
   - Install from VS Code Marketplace
   - Extension ID: `ms-dotnettools.csdevkit` or `ms-dotnettools.csharp`

2. **.NET SDK** installed on your system

## How it Works

The Find Everywhere extension uses VS Code's built-in symbol providers to extract classes, methods, properties, etc. from your code.

For C# files:
- The C# extension provides the symbol provider
- Our extension queries it to get all symbols
- Results are indexed and searchable

## Troubleshooting C# Search

### Symbols Not Appearing for C# Files

**Solution 1: Install C# Extension**
```
1. Open Extensions (Ctrl+Shift+X)
2. Search for "C#"
3. Install "C# Dev Kit" by Microsoft
4. Reload VS Code
```

**Solution 2: Wait for Language Server**
- C# language server takes a few seconds to start
- Wait for "OmniSharp" or "C# Server" to finish loading (check status bar)
- Then re-index: Command Palette > "Developer: Reload Window"

**Solution 3: Open a C# File First**
- Open any `.cs` file in your workspace
- This triggers the C# language server to start
- Then use Find Everywhere

### Manual Reindex

After installing C# extension:
1. Command Palette (`Ctrl+Shift+P`)
2. Type "Developer: Reload Window"
3. The extension will re-index with C# symbols now available

## Verified Support

The extension indexes symbols from these languages:
- ✅ **TypeScript/JavaScript** - Built-in VS Code support
- ✅ **C#** - Requires C# extension
- ✅ **Python** - Requires Python extension
- ✅ **Java** - Requires Java extension
- ✅ **Go** - Requires Go extension
- ⚠️ **Others** - Depends on language extension being installed

## File Extensions Indexed by Default

```json
"findEverywhere.fileExtensions": [
  "ts", "tsx", "js", "jsx",
  "py",
  "java",
  "cs",           // C# files
  "cpp", "c", "h",
  "go",
  "rb",
  "php"
]
```

Make sure `.cs` is in your configured file extensions (it is by default).
