## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.

## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.

## 2024-10-24 - JSON Injection via String.replace()
**Vulnerability:** Injecting JSON strings into HTML using `String.prototype.replace(regex, jsonString)`.
**Learning:** If user-controlled data is present in the JSON string (e.g. paths), regex replacement tokens like `$&` can cause JSON corruption. Additionally, injecting unsanitized JSON directly into an HTML template allows for XSS if the data contains `</script>`.
**Prevention:** Sanitize `<` to `\u003c` in the JSON string before injection, and use a replacer function `() => jsonString` in `.replace()` instead of passing the string directly.
