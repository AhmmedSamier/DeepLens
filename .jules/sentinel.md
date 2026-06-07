
## 2026-06-07 - [Cross-Site Scripting (XSS) in Webview]
**Vulnerability:** XSS vulnerability in `vscode-extension/src/deeplens-view-provider.ts` where user-controlled search result data (`item.name`, `item.detail`, `item.filePath`) was rendered using `innerHTML` with a custom `escapeHtml` function.
**Learning:** Custom HTML escaping functions are often incomplete and error-prone. Using `innerHTML` inherently increases XSS risk, especially in VS Code Webviews where CSP is applied but script execution might still be possible if escaping fails.
**Prevention:** Always use `textContent` to safely insert text into dynamically created DOM elements. Strictly avoid `innerHTML` when handling user input or external data.
