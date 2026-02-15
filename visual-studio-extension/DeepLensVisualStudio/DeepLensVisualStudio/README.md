<div align="center">
  <img src="https://raw.githubusercontent.com/AhmmedSamier/DeepLens/master/visual-studio-extension/DeepLensVisualStudio/DeepLensVisualStudio/icon.png" width="80" alt="DeepLens Logo">
  <h1>DeepLens for Visual Studio</h1>
  <p><b>High-performance "Search Everywhere" for Visual Studio 2022 & 2026</b></p>
</div>

DeepLens brings the ultimate "Search Everywhere" experience to Visual Studio. Powered by a high-performance standalone search engine, it provides instant, unified access to types, symbols, files, and API endpoints across your entire solution with lightning-fast fuzzy matching and CamelHumps support.

## 🌟 Key Features

### 🔍 **Search Everywhere**
The definitive navigation tool for Visual Studio. Access everything in your solution from a single, responsive interface.
- **Classes & Types**: Find classes, interfaces, and enums instantly.
- **Methods & Symbols**: Search for functions, methods, and variables.
- **Files**: Locate any file by name or relative path.
- **API Endpoints**: Specialized search for ASP.NET and web API endpoints.
- **Text Search**: Full-text search integrated directly into the search experience.

### 🍱 **Integrated Tool Window**
DeepLens is now a first-class citizen in Visual Studio, living in its own Tool Window.
- **No Focus Issues**: Seamlessly integrates with the IDE without stealing focus from the editor.
- **Dockable**: Pin it, dock it, or keep it floating—it's part of your layout.
- **Theme Aware**: Automatically matches Visual Studio's Light, Dark, and Blue themes.

### ⚡ **Smart Matching Engine**
- **Fuzzy Search**: Type partial matches like `usebas` to find `useCallback`.
- **CamelHumps Support**: Type `UB` to find `UserButton` or `UserBinding`.
- **High Performance**: Designed to handle massive solutions with tens of thousands of files in milliseconds.

### 🎯 **Premium UI/UX**
- **Integrated Filters**: Quickly toggle search scopes (All, Types, Symbols, Files, Endpoints, Text) via dedicated buttons with tooltips.
- **Context Actions**: Right-click or use icons to "Reveal in File Explorer" or "Copy Path" directly from results.
- **Live Preview**: Preview files when navigating through search results with arrow keys (150ms debounce).
- **Welcome Items**: Helpful tips and shortcuts when no search history exists.
- **Clear History**: Easily clear recent search history with confirmation dialog.

### ⌨️ **Slash Commands & History**
- **Filter with ease**: Type `/t ` for types, `/f ` for files, `/txt ` for text search, `/cmd ` for commands.
- **Quick History**: DeepLens remembers your recent searches and frequently visited files.
- **History Management**: Clear your search history directly from the search interface.

### 💎 **Activity-Based Personalization**
- **Smart Ranking**: Results are ranked based on your usage patterns.
- **Configurable Weight**: Adjust how much activity affects results (0-1 scale).
- **Automatic Tracking**: File access and search usage are tracked automatically.

### 🔧 **Visual Studio Command Search**
- **Command Indexing**: Search and execute Visual Studio commands via `/cmd` or `>` prefix.
- **Human-Readable Titles**: Commands are displayed with readable names.
- **Quick Execution**: Execute commands directly from search results.

### 🌐 **Git Integration**
- **Auto-Reindexing**: Automatically triggers re-indexing on branch switches.
- **Change Detection**: Monitors git HEAD changes and updates index accordingly.
- **Debounced Updates**: 3-second delay to prevent excessive re-indexing.

### 📊 **Status Bar Integration**
- **Live Progress**: See real-time indexing progress with color-coded icons.
- **Click to View Stats**: Click status bar to view index statistics.
- **Dynamic Updates**: Status updates automatically during indexing phases.

### ⚙️ **Comprehensive Configuration**
- **Options Page**: Access settings via Tools > Options > DeepLens.
- **Configurable Options**: 
  - Maximum results, text search, CamelHumps matching
  - Activity tracking enabled/weight
  - Search concurrency, file extensions, exclude patterns
  - CodeLens settings (when implemented)
  - File icons (experimental)

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift` `Shift` (Double Press) | **Global Search**: Open/Focus DeepLens Search Everywhere |
| `Arrow Keys` | Navigate through search results (with preview) |
| `Enter` | Open selected result in editor |
| `Escape` | Return focus to the editor |

### Available Commands

Open the Command Palette (`Ctrl+Q`) and search for:
- `DeepLens: Search Everywhere` - Main search interface
- `DeepLens: Rebuild Index` - Manually trigger a full re-index
- `DeepLens: Clear Index Cache` - Clear the local index cache
- `DeepLens: Index Status` - View detailed stats and manage the search index

## 🚀 Performance First

DeepLens offloads indexing and search to a high-performance background process (powered by Bun/Node.js and Tree-sitter), ensuring Visual Studio remains responsive even during intensive indexing.

## 📦 Installation

1. Download the latest `.vsix` from the [Releases](https://github.com/AhmmedSamier/DeepLens/releases) page.
2. Double-click to install.
3. Restart Visual Studio.

## ⚙️ Configuration

Customize DeepLens to fit your workflow in Tools > Options > DeepLens:

- **Search**: Maximum results, enable text search, CamelHumps matching, search concurrency
- **Activity Tracking**: Enable/disable activity tracking, set activity weight (0-1)
- **Indexing**: File extensions to index, exclude patterns, respect .gitignore
- **CodeLens**: Enable CodeLens, show implementations, minimum references threshold
- **Experimental**: Enable file icons

## 🛠️ Requirements

- **Visual Studio 2022** (v17.0+) or **Visual Studio 2026**.
- **Bun** (Recommended) or **Node.js**: powers the high-performance LSP engine.

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

## 📝 Notes

- Visual Studio extension uses a Tool Window approach (better for VS) vs QuickPick (VS Code)
- Some features may need Visual Studio-specific implementations
- Configuration system uses Visual Studio Options Pages rather than JSON settings
- Visual Studio has unique features (Tool Window, theme awareness) not in VS Code

## 📜 License

MIT License - Copyright (c) 2026 AhmmedSamier
