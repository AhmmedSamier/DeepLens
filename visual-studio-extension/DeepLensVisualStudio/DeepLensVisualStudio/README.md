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
- **Integrated Filters**: Quickly toggle search scopes (Types, Symbols, Files, Endpoints, Text) via dedicated buttons.
- **Context Actions**: Right-click or use icons to "Reveal in File Explorer" or "Copy Path" directly from results.
- **Live Preview**: Single-click navigation that opens and centers the result in the editor instantly.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift` `Shift` (Double Press) | **Global Search**: Open/Focus DeepLens Search Everywhere |
| `Arrow Keys` | Navigate through search results |
| `Enter` | Open selected result in editor |
| `Escape` | Return focus to the editor |

## 🚀 Performance First

DeepLens offloads indexing and search to a high-performance background process (powered by Bun/Node.js and Tree-sitter), ensuring Visual Studio remains responsive even during intensive indexing.

## 📦 Installation

1. Download the latest `.vsix` from the [Releases](https://github.com/AhmmedSamier/DeepLens/releases) page.
2. Double-click to install.
3. Restart Visual Studio.

## 🛠️ Requirements

- **Visual Studio 2022** (v17.0+) or **Visual Studio 2026**.
- **Bun** (Recommended) or **Node.js**: powers the high-performance LSP engine.

## 📜 License

MIT License - Copyright (c) 2026 AhmmedSamier
