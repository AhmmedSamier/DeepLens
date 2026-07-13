## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2026-07-13 - JSON String Replacement Injection and Corruption
**Vulnerability:** Injecting `JSON.stringify` output directly into HTML templates using `String.prototype.replace(regex, string)` is vulnerable to both XSS (if `<script>` breakout sequences like `</script>` are present) and data corruption (if regex replacement tokens like `$&` are present in user-controlled strings such as paths).
**Learning:** `String.prototype.replace` with a string argument evaluates special replacement tokens. The `JSON.stringify` representation of `<` allows `<script>` tag escapes.
**Prevention:** Always sanitize JSON by escaping `<` (e.g. `replace(/</g, '\\u003c')`) and use a replacer function (e.g., `replace(regex, () => jsonString)`) to bypass token evaluation.
