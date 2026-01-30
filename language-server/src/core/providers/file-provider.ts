import { SearchEngine } from '../search-engine';
import { SearchResult, SearchScope } from '../types';
import { ISearchProvider, SearchContext } from './interface';

export class FileProvider implements ISearchProvider {
    id = 'files';
    priority = 200;

    constructor(private engine: SearchEngine) {}

    async search(context: SearchContext): Promise<SearchResult[]> {
        const { scope, query } = context;
        if (query.length === 0) return [];

        if (
            scope !== SearchScope.EVERYTHING &&
            scope !== SearchScope.FILES &&
            scope !== SearchScope.OPEN &&
            scope !== SearchScope.MODIFIED
        ) {
            return [];
        }

        return this.engine.performFileSearch(context);
    }
}
