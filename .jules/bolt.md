## 2026-08-20 - Fast HTTP Method Check
**Learning:** Checking for HTTP methods using regex `HTTP_METHOD_REGEX.test(q.slice(0, methodSeparator))` incurs string slicing overhead and regex parsing overhead.
**Action:** Replace regex HTTP method checking with a static `RouteMatcher.isHttpMethod(q, length)` helper using a switch statement based on the prefix length and bitwise `.charCodeAt()` matching to drastically reduce overhead in hot paths (~2x faster).
