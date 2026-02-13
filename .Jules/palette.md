## 2024-02-13 - Auto-select recovery action on empty search
**Learning:** When a search returns no results, users often want to try a broader search or a different tool immediately. Auto-selecting the "Switch Scope" or "Native Search" action reduces friction significantly by allowing them to just press Enter, instead of navigating down the list.
**Action:** For empty states in QuickPicks, identify the primary recovery action and set `activeItems` to pre-select it, while keeping the "No results" message visible but passive.
