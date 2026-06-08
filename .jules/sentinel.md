## 2026-06-08 - Prevent XSS in Webview
**Vulnerability:** XSS vulnerability in VS Code Webview search results due to using `.innerHTML` combined with user input, despite an `escapeHtml` function.
**Learning:** Using `.innerHTML` for rendering dynamic content in Webviews is a significant risk. Even with a custom `escapeHtml` function, edge cases or poorly implemented escaping can lead to XSS.
**Prevention:** Always use `.textContent` and programmatically create DOM elements (`document.createElement`) when rendering user-provided data or dynamic content in Webviews.
