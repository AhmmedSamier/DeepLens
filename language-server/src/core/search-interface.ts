import { SearchOptions, SearchResult } from './types';

/**
 * Interface for search functionality, can be implemented by an in-process engine
 * or a remote LSP client.
 */
export interface ISearchProvider {
    search(options: SearchOptions): Promise<SearchResult[]> | SearchResult[];
    burstSearch(options: SearchOptions): Promise<SearchResult[]> | SearchResult[];

    // Optional methods for activity tracking and history
    recordActivity?(itemId: string): Promise<void> | void;
    resolveItems?(ids: string[]): Promise<SearchResult[]> | SearchResult[];
}
