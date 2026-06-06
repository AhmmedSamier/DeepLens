## 2024-05-18 - Prevent XSS in VS Code Webviews
**Vulnerability:** XSS vulnerability in `deeplens-view-provider.ts` due to dynamic rendering using `innerHTML` combined with a custom `escapeHtml` function.
**Learning:** Even with custom escaping, using `innerHTML` opens up potential vectors if the escaping isn't fully robust. `escapeHtml` was previously needed but failed to provide complete safety.
**Prevention:** Strictly use `document.createElement()` and assign content using `.textContent`. This inherently blocks XSS without the need for custom escaping functions.
