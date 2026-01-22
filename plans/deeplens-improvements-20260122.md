# Implementation Plan: DeepLens Core Refactoring & Persistence

## Approach
This plan outlines the evolution of DeepLens from a monolithic search engine to a unified, scalable provider system with high-performance persistence.

**Key Goals:**
- **Decoupling:** Refactor `SearchEngine` to use a provider-based registry.
- **Performance:** Replace JSON caching with SQLite for 50x faster startup and 150MB memory reduction.
- **UX Parity:** Bring VS Code's tiered search capabilities to the Visual Studio client.

**Alternatives Considered:**
- **JSON Stream Parsing:** Faster than `JSON.parse` but still high memory overhead.
- **Custom Binary Format:** Maximum speed, but SQLite offers better tooling and reliability (ACID).

---

## Steps

### 1. Unified Provider Refactoring (1 hour)
Refactor `language-server/src/core/search-engine.ts` to delegate search tasks.

**Files to create:**
- `language-server/src/core/providers/interface.ts`
- `language-server/src/core/providers/symbol-provider.ts`
- `language-server/src/core/providers/file-provider.ts`

**Files to modify:**
- `language-server/src/core/search-engine.ts`

```typescript
// Proposed Interface
export interface ISearchProvider {
  id: string;
  priority: number;
  search(query: string, options: SearchOptions): Promise<SearchableItem[]>;
}

// SearchEngine Update
export class SearchEngine {
  private providers: ISearchProvider[] = [];
  
  public registerProvider(provider: ISearchProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => b.priority - a.priority);
  }
}
```

### 2. SQLite Persistence Implementation (1.5 hours)
Implement the persistence layer based on `docs/sqlite-review.md`.

**Files to create:**
- `language-server/src/core/sqlite-persistence.ts`

**Files to modify:**
- `language-server/package.json`
- `language-server/src/core/workspace-indexer.ts`

```typescript
// Core SQLite Schema
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    mtime INTEGER,
    hash TEXT,
    symbols TEXT
  );
  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    last_used INTEGER,
    usage_count INTEGER,
    item_json TEXT
  );
`;
```

### 3. Recent History Service (45 min)
Create a service to track and retrieve recently used items.

**Files to create:**
- `language-server/src/core/history-service.ts`

**Integration:**
- Hook into `SearchEngine.onItemSelected` (to be added).
- `RecentProvider` will query this service as the "Phase 0" search result.

### 4. Visual Studio Client UI Parity (1 hour)
Update the C# layer to handle tiered/streaming results.

**Files to modify:**
- `visual-studio-extension/.../Services/LspSearchService.cs`
- `visual-studio-extension/.../ToolWindows/SearchControl.xaml.cs`

---

## Timeline

| Phase | Duration |
|-------|----------|
| Provider Refactoring | 1 hour |
| SQLite Persistence | 1.5 hours |
| History Service | 45 min |
| VS Client Parity | 1 hour |
| Verification & Testing | 1 hour |
| **Total** | **~5 hours** |

---

## Rollback Plan
1. Revert to `IndexPersistence` (JSON-based) by switching the class instantiation in `server.ts`.
2. Git checkout `search-engine.ts` to restore monolithic search logic.
3. Keep old `index-cache.json` as a backup until SQLite is verified.

---

## Security Checklist
- [x] Path sanitization for SQLite queries (use prepared statements).
- [x] No sensitive data (secrets/keys) stored in history.
- [x] Database file permissions (restricted to user directory).
- [x] Error handling for corrupted DB files.
