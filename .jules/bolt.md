## 2024-05-23 - Lazy Object Access with SoA
**Learning:** Pure Struct of Arrays (SoA) conversions (e.g. `item.type` -> `types[i]`) might not yield performance gains if the original object is still accessed in the hot loop, as V8 optimizes property access well. The real win comes from using SoA to *avoid* accessing the heavy object entirely until it passes the filter (lazy loading).
**Action:** When converting to SoA, ensure the hot loop relies *only* on the parallel arrays and delays accessing the original object until absolutely necessary.

## 2024-05-23 - CamelHumps Priority
**Learning:** When multiple search strategies are available, running the cheaper, more specific strategy (CamelHumps) *first* and skipping the expensive general strategy (Fuzzy) if a strong match is found can significantly reduce CPU time (20%+ speedup) for matching queries.
**Action:** Always order search strategies from cheapest/most-specific to most expensive, and implement early exit thresholds where possible.
