# Quickstart: File Icons in Search Results

## Development Setup

1. **Install Dependencies**:
   ```bash
   cd vscode-extension
   bun install
   ```

2. **Verify Environment**:
   Ensure you have VS Code installed to run the extension host tests.

## Running the Feature

1. **Build Extension**:
   ```bash
   cd vscode-extension
   bun run compile
   ```

2. **Launch Extension**:
   - Open the project in VS Code.
   - Press `F5` to launch the "Run Extension" configuration.
   - In the new window, press `Shift-Shift` to open DeepLens.
   - Search for files and observe the icons.

## Testing

1. **Integration Tests**:
   The feature relies on integration tests to verify icon rendering (checking the `iconPath` property).
   ```bash
   cd vscode-extension
   bun run test
   ```

2. **Manual Verification**:
   - Install an icon theme (e.g., "Material Icon Theme").
   - Switch themes and verify icons update in search results.
