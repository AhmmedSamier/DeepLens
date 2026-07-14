## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2024-05-24 - JSON Injection in Webview HTML Templates
**Vulnerability:** Unsanitized JSON dynamically injected into HTML Webview templates using `String.prototype.replace()`.
**Learning:** Using `replace()` with a string replacement argument exposes the application to regex substitution token injection (e.g., `$&`), which corrupts the JSON if the user controls the input. Also, `<` must be escaped to prevent XSS when embedding JSON in HTML scripts.
**Prevention:** Sanitize JSON (escape `<` to `\u003c`) and always use a replacer function (e.g., `() => sanitizedJson`) instead of a raw string when replacing placeholders in HTML.
