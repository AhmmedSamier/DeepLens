## 2026-06-09 - Insecure CSP Nonce Generation
**Vulnerability:** CSP nonce generated using Math.random()
**Learning:** Math.random() is predictable and makes CSP ineffective against targeted XSS attacks.
**Prevention:** Always use cryptographically secure random number generators like crypto.randomBytes() for security tokens and nonces.
## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.
**Prevention:** Always use native DOM methods like `document.createElement`, `classList.add`, and `.textContent` when injecting structure or data into webviews to ensure robust, built-in XSS protection.
## 2025-02-24 - Fix JSON string regex replace bug and DOM XSS in Webview

**Vulnerability:** Injecting untrusted JSON directly into a script tag string without replacing `<` with `\u003c` opens a vector for XSS in VS Code webviews, as well as replacing strings using a regex containing backslashes inside `String.prototype.replace()`.
**Learning:** `String.prototype.replace(search, replacementString)` parses tokens in `replacementString` such as `$&` or `$1` leading to string malformation. The existing code escaped `\` to `\\` in an attempt to prevent this, but the proper fix is to use a replacer function instead: `replace(search, () => replacementString)`.
**Prevention:** Avoid injecting JSON into HTML script blocks using string replacement. If you must, use a function `(json) => json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')` to sanitize output and use a replacer function like `() => replacementString` as the second argument to `replace`.
