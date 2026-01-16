# Testing DeepLens Extension

## Quick Test Steps

1. **Open the finder project in VS Code**
   - Open folder: `d:\source-code\finder`

2. **Launch Extension Development Host**
   - Press `F5` (or Run > Start Debugging)
   - This opens a new VS Code window with your extension loaded

3. **Test the Keybinding**
   - In the Extension Development Host window, press `Shift` twice quickly
   - The DeepLens dialog should appear

4. **Test Search Functionality**
   - Type a search query (e.g., "SearchEngine", "indexWorkspace", etc.)
   - You should see results appear

## Troubleshooting

### If Shift+Shift doesn't work:
- **Check**: Are you in the Extension Development Host window (not the original window)?
- **Try**: Use Command Palette (`Ctrl+Shift+P`) and type "DeepLens" to trigger manually
- **Check**: Look at the Debug Console for any errors

### If search doesn't find methods:
- **Check**: Was the workspace indexed? Look for "Indexing workspace..." message
- **Check**: Open a TypeScript/JavaScript file first so VS Code loads the language server
- **Try**: Use Command Palette > "DeepLens: Rebuild Index" (if we added that command)

### Debug Console
- In the original VS Code window (not Extension Development Host)
- Go to Debug Console tab
- Look for errors or "DeepLens extension is now active" message

## Manual Test Command

You can also test by opening Command Palette in the Extension Development Host:
1. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "DeepLens"
3. Select the command
4. This should open the search regardless of keybinding
