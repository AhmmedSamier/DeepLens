## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2026-07-07 - Webview Template Substitution and XSS Risk
**Vulnerability:** String substitution injection leading to broken JSON and potential XSS in VS Code Webview initialization.
**Learning:** Using `String.prototype.replace(regex, string)` to inject JSON into HTML is dangerous because strings with regex tokens like `$&` or `$1` (e.g., in a workspace folder path) are evaluated, breaking JSON syntax. Additionally, unescaped `<` characters in the JSON can break out of script tags in the template, leading to XSS.
**Prevention:** Always use replacement functions (e.g., `replace(regex, () => value)`) when substituting untrusted strings, and escape HTML-sensitive characters (`<` to `\u003c`) when injecting JSON into inline scripts.
