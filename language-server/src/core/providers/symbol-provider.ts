import { SearchResult, SearchScope } from '../types';
import { ISearchProvider, SearchContext } from './interface';

export class SymbolProvider implements ISearchProvider {
    id = 'symbols';
    priority = 100;

    constructor(private engine: any) {}

    async search(context: SearchContext): Promise<SearchResult[]> {
        const { scope, query } = context;
        if (query.length === 0) return [];
        
        if (scope !== SearchScope.EVERYTHING && 
            scope !== SearchScope.SYMBOLS && 
            scope !== SearchScope.TYPES && 
            scope !== SearchScope.PROPERTIES &&
            scope !== SearchScope.ENDPOINTS) {
            return [];
        }

        return this.engine.performSymbolSearch(context);
    }
}