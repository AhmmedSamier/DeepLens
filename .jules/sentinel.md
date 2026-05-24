## 2026-05-24 - Restrict Webview local resource loading
**Vulnerability:** Missing local resource restrictions in WebviewPanel creation.
**Learning:** By default, VS Code webviews have broad access to local file paths, potentially allowing malicious content loaded into the webview to read local files (Path Traversal/LFI risk).
**Prevention:** Always set `localResourceRoots: []` when creating a `WebviewPanel` if the webview does not require loading local files (e.g., when content is generated programmatically or inline).
