## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2024-07-12 - Webview Template Injection and XSS
**Vulnerability:** XSS and string corruption via Webview string replacements (e.g., `$&`, `<script>`).
**Learning:** Direct string `replace` without replacer functions allows regex tokens in user-controlled inputs to alter replacement output. Unsanitized JSON injected into HTML allows XSS if it contains `<`.
**Prevention:** Always sanitize `<` to `\u003c` in JSON injected into HTML. Use replacer functions `() => str` when injecting variables into templates via `String.prototype.replace`.
