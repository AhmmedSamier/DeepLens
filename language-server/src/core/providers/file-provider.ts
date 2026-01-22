import { SearchResult, SearchScope } from '../types';
import { ISearchProvider, SearchContext } from './interface';

export class FileProvider implements ISearchProvider {
    id = 'files';
    priority = 200;

    constructor(private engine: any) {}

    async search(context: SearchContext): Promise<SearchResult[]> {
        const { scope, query } = context;
        if (query.length === 0) return [];

        if (scope !== SearchScope.EVERYTHING && scope !== SearchScope.FILES) {
            return [];
        }

        return this.engine.performFileSearch(context);
    }
}
