<div align="center">
  <img src="https://raw.githubusercontent.com/AhmmedSamier/DeepLens/master/vscode-extension/icon.png" width="80" alt="DeepLens Logo">
  <h1>DeepLens</h1>
  <p><b>High-performance "Search Everywhere" for VS Code and Visual Studio 2026</b></p>
</div>

DeepLens provides a powerful, unified search experience across your entire workspace, powered by a high-performance standalone search engine. Quickly find types, symbols, files, and even API endpoints with lightning-fast fuzzy matching, CamelHumps support, and activity-based ranking.

## 🌟 Key Features

### 🔍 **Search Everywhere**

The ultimate navigation tool. Access everything in your workspace from a single dialog. `Shift-Shift` to open.

- **Classes & Types**: Find classes, interfaces, and enums instantly.
- **Methods & Symbols**: Search for functions, methods, and variables.
- **Files**: Locate any file by name or relative path.
- **Text Search**: Instant full-text search across your entire codebase with high-performance exclusion rules.
- **Commands**: Execute VS Code commands directly from the search bar.
- **API Endpoints**: Specialized search for ASP.NET and web API endpoints.

### ⌨️ **Slash Commands & History**

DeepLens features an intuitive command-line style interface within the search bar.
- **Filter with ease**: Type `/t ` for types, `/f ` for files, or `/txt ` for text search.
- **Quick History**: DeepLens remembers your recent searches and frequently visited files, making it easy to jump back into context.
- **History Management**: Easily clear your search history directly from the search interface.

### 💎 **Rider-style CodeVision**

DeepLens brings professional IDE features to VS Code with integrated CodeLens counts.

- **Reference Counting**: See exactly how many times a class, method, or property is used directly above its definition (`Shift+F12`).
- **Implementation Tracking**: Quickly see how many classes implement an interface or override a virtual method (`Ctrl+F12`).
- **Quick Navigation**: Click the counts to peek or jump to references/implementations.
- **Smart Filtering**: Configurable to hide counts for simple items to reduce noise.

### 🌐 **Specialized Endpoint Search**

DeepLens automatically extracts and indexes API endpoints (like `GET /api/users`) from your code, allowing you to navigate to the controller or handler responsible for a specific route.

### ⚡ **Smart Matching Engine**

- **Fuzzy Search**: Type partial matches like `usebas` to find `useCallback`.
- **CamelHumps**: Type `RFC` to find `React.FC` or `RequestForComment`.
- **Ranking**: Results are ranked based on match quality, item type, and your personal usage patterns.

### 🎯 **Premium UI/UX**

- **Integrated Filters**: Toggle between search scopes (All, Types, Symbols, Files, Endpoints, Text) with a single click or keyboard shortcut.
- **Live Statistics**: See real-time counts of files and symbols as they are indexed via the status bar.
- **Activity Ranking**: DeepLens learns which files you work on most and boosts them in search results.

### 🚀 **Performance First**

- **Tree-sitter Powered**: Uses native Tree-sitter parsers for C#, TypeScript, JavaScript, Python, Go, Java, and more for near-instant indexing.
- **Git Aware**: Automatically respects your `.gitignore` and detects branch switches to keep the index fresh.
- **Persistence**: Caches indices across sessions for instant startup.
- **High Concurrency**: Tuned for multi-core systems to index large repositories in seconds.

## ⌨️ Keyboard Shortcuts & Commands

### Keyboard Shortcuts

| Shortcut                       | Action                                             |
| ------------------------------ | -------------------------------------------------- |
| `Shift` `Shift` (Double Press) | **Global Search**: Open DeepLens Search Everywhere |

### Available Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for:

| Command                         | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `DeepLens: Search Everywhere`   | Main search interface with all filters            |
| `DeepLens: Rebuild Index`       | Manually trigger a full re-index of the workspace |
| `DeepLens: Clear Index Cache`   | Clear the local index cache and rebuild           |
| `DeepLens: Show Index Statistics` | View detailed stats and manage the search index |

## ⚙️ Configuration

Customize DeepLens to fit your workflow in VS Code Settings:

```json
{
    // Patterns to exclude from indexing
    "deeplens.excludePatterns": ["**/node_modules/**", "**/dist/**", "**/out/**", "**/.git/**", "**/build/**"],

    // Maximum number of search results to display
    "deeplens.maxResults": 50,

    // Enable full-text search across files
    "deeplens.enableTextSearch": true,

    // Show reference/implementation counts above definitions (Rider-style)
    "deeplens.codeLens.enabled": true,

    // Show implementation counts above classes, interfaces and methods
    "deeplens.codeLens.showImplementations": true,

    // Minimum number of references to display code lens (0 = show all)
    "deeplens.codeLens.minRefsToShow": 0,

    // Number of files to scan in parallel during text search
    "deeplens.searchConcurrency": 60,

    // Enable CamelHumps matching (e.g., 'RFC' -> 'React.FC')
    "deeplens.enableCamelHumps": true,

    // Respect .gitignore files when indexing (highly recommended)
    "deeplens.respectGitignore": true,

    // File extensions to index for search
    "deeplens.fileExtensions": ["ts", "tsx", "js", "jsx", "py", "java", "cs", "cpp", "c", "h", "go", "rb", "php"],

    // Enable personalized results based on your usage activity
    "deeplens.activity.enabled": true,

    // Personalization: How much your usage affects results (0-1)
    "deeplens.activity.weight": 0.3
}
```

## 📂 Supported Languages

DeepLens features native high-performance indexing via Tree-sitter for:

- ✅ **C#** (.cs)
- ✅ **TypeScript / JavaScript** (.ts, .tsx, .js, .jsx)
- ✅ **Python** (.py)
- ✅ **Go** (.go)
- ✅ **Java** (.java)
- ✅ **C / C++** (.c, .cpp, .h)
- ✅ **Ruby** (.rb)
- ✅ **PHP** (.php)

_For **CodeVision (References/Implementations)**, DeepLens leverages VS Code's built-in language providers, supporting nearly all languages with installed extensions._

## 📜 License

MIT License - Copyright (c) 2026 AhmmedSamier
