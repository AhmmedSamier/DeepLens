## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2026-07-17 - XSS in HTML Template JSON Injection
**Vulnerability:** XSS vulnerability and string corruption via regex tokens (e.g., `$&`) due to direct string concatenation and string-based regex replacement of JSON into HTML webviews.
**Learning:** Using `JSON.stringify()` output directly in regex replace operations can corrupt JSON if user data contains regex substitution tokens like `$&`. Also, direct JSON injection into HTML without escaping `<` and `>` can result in XSS if an attacker inputs `</script><script>`.
**Prevention:** Always use replacer functions `str.replace(regex, () => jsonString)` instead of replacement strings, and sanitize JSON injected into HTML with `.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')`.
