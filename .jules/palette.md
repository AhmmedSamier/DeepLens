## 2024-05-24 - QuickPick busy state reset
**Learning:** For VS Code extension `QuickPick` elements, if an interaction (e.g. prompt rendering) is short-circuited or handles a terminal modal action (like a confirmation), `quickPick.busy = false` must be explicitly set before presenting the modal, otherwise it will remain visually stuck in the loading state from a previous search.
**Action:** Always verify `quickPick.busy` is cleanly reset before rendering standalone prompts or static confirm/cancel lists within the same UI instance.
