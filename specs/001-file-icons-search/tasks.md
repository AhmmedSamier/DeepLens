# Tasks: File Icons in Search Results

**Feature Branch**: `001-file-icons-search` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Phase 1: Setup
> **Goal**: Ensure development environment is ready and dependencies are correct.

- [x] T001 Verify project builds by running `bun run compile` in `vscode-extension`
- [x] T002 Verify `vscode` engine version in `vscode-extension/package.json` is ^1.75.0 or higher to support `QuickPickItem.resourceUri` (ThemeIcon.File support)

## Phase 2: Foundational
> **Goal**: Prepare data structures for icon support.
> **Independent Test**: Code compiles with new interface properties.

- [x] T003 [US1] Update `SearchResultItem` interface in `vscode-extension/src/search-provider.ts` to include `resourceUri` (ensure compatibility with `vscode.QuickPickItem`)

## Phase 3: User Story 1 - File Search with Visual Icons (P1)
> **Goal**: Users see native file icons in search results.
> **Independent Test**: Search for files displays VS Code style icons next to results.

- [x] T004 [US1] Update `resultToQuickPickItem` in `vscode-extension/src/search-provider.ts` to generate `vscode.Uri.file(item.filePath)` for FILE items
- [x] T005 [US1] Update `resultToQuickPickItem` in `vscode-extension/src/search-provider.ts` to set `iconPath` to `vscode.ThemeIcon.File` when item type is FILE
- [x] T006 [US1] Update `resultToQuickPickItem` in `vscode-extension/src/search-provider.ts` to assign the generated URI to `resourceUri` property of the returned item
- [x] T007 [US1] Ensure non-file items (Symbols, Classes) continue to use `getIconForItemType` logic in `vscode-extension/src/search-provider.ts` without `resourceUri` interference
- [x] T008 [US1] Run `bun run compile` in `vscode-extension` to verify implementation

## Phase 4: User Story 2 - VSCode Explorer Consistency (P2)
> **Goal**: Ensure icons match VS Code Explorer style and handle dirty states.
> **Independent Test**: Dirty files show unsaved indicators; specific file types match Explorer.

- [x] T009 [US2] Verify `isFileDirty` logic in `vscode-extension/src/search-provider.ts` and ensure the `$(circle-filled)` indicator in `description` coexists correctly with the new `iconPath`
- [x] T010 [US2] Review `resultToQuickPickItem` in `vscode-extension/src/search-provider.ts` to ensure `detail` and `description` fields align with standard VS Code File Pickers (e.g. standardizing path display)

## Phase 5: User Story 3 - Performance with Icon Rendering (P3)
> **Goal**: Maintain search performance with added icon logic.
> **Independent Test**: Search rendering time remains within 10% of baseline.

- [x] T011 [US3] Review `resultToQuickPickItem` in `vscode-extension/src/search-provider.ts` to ensure `vscode.Uri.file` usage is efficient and doesn't introduce blocking I/O (it should be synchronous and fast)
- [x] T012 [US3] Perform a manual search burst test to verify UI responsiveness with the new icon logic

## Final Phase: Polish & Cross-Cutting Concerns
> **Goal**: Cleanup and final verification.

- [x] T013 Remove any temporary logging or debug statements added during implementation
- [x] T014 Run full project test suite `bun run test` in `vscode-extension` to ensure no regressions

## Dependencies

- **Phase 3 (US1)** depends on **Phase 2**
- **Phase 4 (US2)** depends on **Phase 3**
- **Phase 5 (US3)** depends on **Phase 3**

## Parallel Execution Opportunities

- T009 (Dirty logic verification) can be done in parallel with T004-T006.
- T011 (Performance review) can be done in parallel with implementation.

## Implementation Strategy

We will modify `search-provider.ts` to leverage VS Code's native `QuickPickItem.resourceUri` and `ThemeIcon.File`. This delegates the heavy lifting of icon resolution to VS Code itself, ensuring perfect consistency and minimal performance overhead. We will start by updating the interface, then implement the logic in the transformation method `resultToQuickPickItem`.
