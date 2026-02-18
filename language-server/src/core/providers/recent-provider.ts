import { ActivityTracker } from '../activity-tracker';
import { SearchResult } from '../types';
import { ISearchProvider, SearchContext } from './interface';

export class RecentProvider implements ISearchProvider {
    id = 'recent';
    priority = 1000; // Highest priority for instant results

    constructor(private readonly tracker: ActivityTracker) {}

    async search(context: SearchContext): Promise<SearchResult[]> {
        // Only return recent items if the query is empty
        if (context.query.length === 0) {
            return this.tracker.getRecentItems(context.maxResults);
        }
        return [];
    }
}
