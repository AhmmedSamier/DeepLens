import { CancellationToken } from 'vscode-languageserver';
import { SearchOptions, SearchResult } from './types';

/**
 * Interface for search functionality, can be implemented by an in-process engine
 * or a remote LSP client.
 */
export interface ISearchProvider {
    search(
        options: SearchOptions,
        token?: CancellationToken | ((result: SearchResult) => void),
    ): Promise<SearchResult[]> | SearchResult[];
    burstSearch(
        options: SearchOptions,
        token?: CancellationToken | ((result: SearchResult) => void),
    ): Promise<SearchResult[]> | SearchResult[];
    resolveItems(itemIds: string[]): Promise<SearchResult[]> | SearchResult[];
    getRecentItems(count: number): Promise<SearchResult[]> | SearchResult[];
    recordActivity(itemId: string): Promise<void> | void;
}
