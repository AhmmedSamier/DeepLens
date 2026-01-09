<div align="center">
  <img src="https://raw.githubusercontent.com/AhmedSamir/DeepLens/master/icon.png" width="80" alt="DeepLens Logo">
  <h1>DeepLens</h1>
  <p><b>High-performance "Search Everywhere" for Visual Studio Code</b></p>
</div>

DeepLens provides a powerful, unified search experience across your entire workspace. Quickly find types, symbols, files, and even API endpoints with lightning-fast fuzzy matching, CamelHumps support, and activity-based ranking.

## 🌟 Key Features

### 🔍 **Search Everywhere**
The ultimate navigation tool. Access everything in your workspace from a single dialog.
- **Classes & Types**: Find classes, interfaces, and enums instantly.
- **Methods & Symbols**: Search for functions, methods, and variables.
- **Files**: Locate any file by name or relative path.
- **Commands**: Execute VS Code commands directly from the search bar.
- **API Endpoints**: Specialized search for ASP.NET and web API endpoints.

### 🌐 **Specialized Endpoint Search**
DeepLens automatically extracts and indexes API endpoints (like `GET /api/users`) from your code, allowing you to navigate to the controller or handler responsible for a specific route.

### ⚡ **Smart Matching Engine**
- **Fuzzy Search**: Type partial matches like `usebas` to find `useCallback`.
- **CamelHumps**: Type `RFC` to find `React.FC` or `RequestForComment`.
- **Ranking**: Results are ranked based on match quality, item type, and your personal usage patterns.

### 🎯 **Premium UI/UX**
- **Integrated Filters**: Toggle between search scopes (All, Types, Symbols, Files, Endpoints) with a single click or keyboard shortcut.
- **Live Statistics**: See real-time counts of files and symbols as they are indexed.
- **Activity Ranking**: DeepLens learns which files you work on most and boosts them in search results.

### 🚀 **Performance First**
- **Tree-sitter Powered**: Uses native Tree-sitter parsers for C#, TypeScript, JavaScript, Python, Go, Java, and more for near-instant indexing.
- **Git Aware**: Automatically respects your `.gitignore` and detects branch switches to keep the index fresh without draining resources.
- **Persistence**: Caches indices across sessions for instant startup.

## ⌨️ Keyboard Shortcuts & Commands

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift` `Shift` (Double Press) | **Global Search**: Open DeepLens Search Everywhere |

### Available Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command | Description |
|---------|-------------|
| `DeepLens: Search Everywhere` | Main search interface with all filters |
| `DeepLens: Rebuild Index` | Manually trigger a full re-index of the workspace |
| `DeepLens: Clear Index Cache` | Clear the local index cache and rebuild |

## ⚙️ Configuration

Customize DeepLens to fit your workflow in VS Code Settings:

```json
{
  // Patterns to exclude from indexing
  "deeplens.excludePatterns": [
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/.git/**",
    "**/build/**"
  ],

  // Maximum number of search results to display
  "deeplens.maxResults": 50,

  // Enable CamelHumps matching (e.g., 'RFC' -> 'React.FC')
  "deeplens.enableCamelHumps": true,

  // Respect .gitignore files when indexing (highly recommended)
  "deeplens.respectGitignore": true,

  // File extensions to index for search
  "deeplens.fileExtensions": [
    "ts", "tsx", "js", "jsx", "py", "java", "cs", "cpp", "c", "h", "go", "rb", "php"
  ],

  // Personalization: How much your usage affects results (0-1)
  "deeplens.activity.weight": 0.3
}
```

## 📂 Supported Languages

DeepLens features native high-performance indexing for:
- ✅ **C#** (.cs)
- ✅ **TypeScript / JavaScript** (.ts, .tsx, .js, .jsx)
- ✅ **Python** (.py)
- ✅ **Go** (.go)
- ✅ **Java** (.java)
- ✅ **C / C++** (.c, .cpp, .h)
- ✅ **Ruby** (.rb)
- ✅ **PHP** (.php)

*Other languages are supported via VS Code's built-in symbol providers.*

## 📜 License

MIT License - Copyright (c) 2026 AhmedSamir