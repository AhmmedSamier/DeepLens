## 2026-06-14 - Webview .innerHTML XSS Vector
**Vulnerability:** Constructing DOM elements by setting `.innerHTML` with concatenated strings or raw HTML templates.
**Learning:** Even if the strings are statically defined, using `.innerHTML` violates strict Content Security Policies (CSP) and creates a theoretical XSS vector if future updates introduce dynamic variables.

## 2024-10-25 - XSS via Unsanitized JSON Injection in Webview
**Vulnerability:** Injecting raw JSON into Webview HTML templates using `String.prototype.replace()` without escaping `<` characters. Additionally, using string replacement for user-controlled data can cause regex substitution tokens like `$&` to corrupt the injected JSON.
**Learning:** When injecting dynamic JSON strings into HTML using `replace()`, any `<` characters inside the JSON can be interpreted by the browser as HTML tags if not properly escaped, leading to XSS vulnerabilities. Also, regex replacement can inadvertently modify the JSON payload.
**Prevention:** Always sanitize JSON by replacing `<` with `\u003c` before injection. Use a replacer function (e.g., `() => sanitizedJson`) instead of a simple replacement string to prevent regex substitution tokens from corrupting the payload.
