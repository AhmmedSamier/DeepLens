# Feature Specification: Improve Search Time

**Feature Branch**: `002-improve-search-time`  
**Created**: 2026-02-18
**Status**: Draft  
**Input**: User description: "improve search time"

## Clarifications

### Session 2026-02-19

- Q: What hardware profile defines "standard developer machine" for SC-001 and SC-002? → A: Mid-range developer laptop (8-core CPU, 16GB RAM, SSD)
- Q: How is search cancellation (FR-003) surfaced in the UI? → A: Escape key + visible ✕ button in the progress indicator
- Q: What is the baseline "previous version" for the 50% latency reduction target in SC-003? → A: The `main` branch HEAD at the time this feature branch was cut
- Q: How should the system behave if the ripgrep binary is unavailable or crashes? → A: Surface an error notification, disable text search gracefully; symbol search remains unaffected
- Q: What happens when a new search is started while one is already in progress? → A: Automatically cancel the in-progress search and start the new one

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fast Symbol Search (Priority: P1)

As a developer, I want to search for a symbol and see results almost instantly so that I can navigate code without breaking my flow.

**Why this priority**: Symbol search is the core navigation feature and its performance directly impacts developer productivity.

**Independent Test**: Can be tested by performing a symbol search and measuring the time from query input to results display. This delivers immediate value by making code navigation faster.

**Acceptance Scenarios**:

1. **Given** a fully indexed workspace, **When** a user initiates a symbol search, **Then** the top 10 results are displayed in under 500ms.
2. **Given** a symbol search is performed, **When** results are displayed, **Then** they are ranked by relevance, considering factors like recent file activity and exact match quality.

---

### User Story 2 - Fast Text Search (Priority: P2)

As a developer, I need to perform a text search across the entire codebase and get results quickly so I can find all occurrences of a specific string or pattern.

**Why this priority**: Text search is crucial for refactoring, finding configuration, and understanding where specific code is used. While important, it is secondary to the instant feedback required for symbol navigation.

**Independent Test**: Can be tested by running a text search for a common token and measuring the total time to receive a complete list of matches.

**Acceptance Scenarios**:

1. **Given** a large workspace (e.g., 1 million+ lines of code), **When** a user searches for a text string, **Then** a complete list of results is returned in under 3 seconds.
2. **Given** a text search is in progress, **When** the search takes longer than 1 second, **Then** the UI displays a progress indicator.

---

### Edge Cases

- What happens if a search is initiated while the workspace is still being indexed? The system should return partial results from the indexed portion and continue searching the rest.
- How does the system handle searches for extremely common strings (e.g., "the", "if")? The search should be cancellable and potentially warn the user about the high number of expected results.
- How does the system handle very large files (e.g., >10MB)? The search should not block the UI and should handle the file efficiently.
- When a user cancels a search (via Escape or ✕ button), the in-progress search MUST be aborted cleanly: the `$/cancelRequest` notification is sent to the server, partial results are discarded, and the UI returns to an idle state without residual spinner or stale results.
- If the `ripgrep` binary is unavailable or its subprocess exits unexpectedly, the system MUST: (1) display a VS Code error notification explaining that text search is unavailable, (2) disable the text search entry point in the UI until the extension is reloaded, and (3) leave symbol search fully operational.
- When a new search query is submitted while a previous search is still running, the previous search MUST be automatically cancelled (via `$/cancelRequest`) before the new search begins. No result merging or queueing occurs; only the latest query's results are displayed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST perform indexing operations in a background process to avoid blocking UI interactions.
- **FR-002**: The system MUST optimize search algorithms for speed, prioritizing symbol search.
- **FR-003**: Users MUST be able to cancel a long-running search operation at any time. Cancellation is surfaced via the **Escape key** and a visible **✕ button** within the progress indicator (consistent with the native VS Code QuickPick UX pattern). Cancellation MUST propagate to the language server via a `$/cancelRequest` LSP notification.
- **FR-004**: The system MUST provide clear visual feedback to the user indicating that a search is in progress, especially for queries expected to take more than a second.
- **FR-005**: If the `ripgrep` binary is unavailable or terminates unexpectedly, the system MUST surface a VS Code error notification, disable the text search UI entry point, and continue serving symbol search without interruption.
- **FR-006**: When a new search query is received while a prior search is still running, the system MUST automatically cancel the prior search via `$/cancelRequest` and begin processing the new query immediately. Result queuing and merging are explicitly out of scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of symbol searches complete in under 500ms for a large codebase (e.g., 5 million lines of code) on a mid-range developer laptop (8-core CPU, 16GB RAM, SSD).
- **SC-002**: 95% of workspace-wide text searches complete in under 3 seconds for a large codebase on a mid-range developer laptop (8-core CPU, 16GB RAM, SSD).
- **SC-003**: User-perceived latency, from typing a query to seeing the first result, is reduced by at least 50% compared to the `main` branch HEAD at the time feature branch `002-improve-search-time` was cut, as measured by automated benchmarks run against an identical corpus and hardware profile.
- **SC-004**: CPU and memory usage during idle periods (no active search or indexing) does not increase by more than 10% from the pre-feature baseline.
