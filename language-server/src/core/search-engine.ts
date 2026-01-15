import * as Fuzzysort from 'fuzzysort';
import { RouteMatcher } from './route-matcher';
import { SearchableItem, SearchItemType, SearchOptions, SearchResult, SearchScope } from './types';
import { ISearchProvider } from './search-interface';

interface PreparedItem {
    item: SearchableItem;
    preparedName: Fuzzysort.Prepared;
    preparedFullName: Fuzzysort.Prepared | null;
    preparedPath: Fuzzysort.Prepared | null;
    preparedCombined: Fuzzysort.Prepared | null;
}

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine implements ISearchProvider {
    private items: SearchableItem[] = [];
    private preparedItems: PreparedItem[] = [];
    private scopedItems: Map<SearchScope, PreparedItem[]> = new Map();
    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;

    /**
     * Set the searchable items and update hot-arrays
     */
    setItems(items: SearchableItem[]): void {
        this.items = items;
        this.rebuildHotArrays();
    }

    /**
     * Add items to the search index and update hot-arrays
     */
    addItems(items: SearchableItem[]): void {
        this.items.push(...items);
        this.rebuildHotArrays();
    }

    /**
     * Remove items from a specific file and update hot-arrays
     */
    removeItemsByFile(filePath: string): void {
        this.items = this.items.filter((item) => item.filePath !== filePath);
        this.rebuildHotArrays();
    }

    /**
     * Rebuild pre-filtered arrays for each search scope and pre-prepare fuzzysort
     */
    private rebuildHotArrays(): void {
        this.scopedItems.clear();
        this.preparedItems = this.items.map((item) => ({
            item,
            preparedName: Fuzzysort.prepare(item.name),
            preparedFullName: item.fullName ? Fuzzysort.prepare(item.fullName) : null,
            preparedPath: item.relativeFilePath ? Fuzzysort.prepare(item.relativeFilePath) : null,
            preparedCombined: item.relativeFilePath
                ? Fuzzysort.prepare(`${item.relativeFilePath} ${item.fullName || item.name}`)
                : null,
        }));

        // Initialize arrays
        for (const scope of Object.values(SearchScope)) {
            this.scopedItems.set(scope, []);
        }

        // Categorize items
        for (const prepared of this.preparedItems) {
            const scope = this.getScopeForItemType(prepared.item.type);
            this.scopedItems.get(scope)?.push(prepared);

            // All items belong to EVERYTHING scope
            this.scopedItems.get(SearchScope.EVERYTHING)?.push(prepared);
        }
    }

    /**
     * Set activity tracker callback
     */
    setActivityCallback(callback: (itemId: string) => number, weight: number): void {
        this.getActivityScore = callback;
        this.activityWeight = weight;
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.items = [];
        this.scopedItems.clear();
    }

    /**
     * Get total number of items
     */
    getItemCount(): number {
        return this.items.length;
    }

    /**
     * Resolve items by their IDs
     */
    resolveItems(ids: string[]): SearchResult[] {
        const idSet = new Set(ids);
        const results: SearchResult[] = [];

        // This is O(N) but typically fast enough for 100k items.
        // For larger scales, a Map<id, item> would be better.
        for (const item of this.items) {
            if (idSet.has(item.id)) {
                results.push({
                    item,
                    score: 1.0,
                    scope: SearchScope.RECENT
                });
            }
        }

        // Return in the order of requested IDs
        const resultMap = new Map(results.map(r => [r.item.id, r]));
        return ids
            .map(id => resultMap.get(id))
            .filter((r): r is SearchResult => r !== undefined);
    }

    /**
     * Perform search
     */
    search(options: SearchOptions): SearchResult[] {
        const { query, scope, maxResults = 50, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) {
            return [];
        }

        // 1. Filter and search - NOW ULTRA FAST using Hot-Arrays
        const filteredItems = this.filterByScope(scope);
        let results = this.fuzzySearch(filteredItems, query);

        // 2. Add CamelHumps results if enabled
        if (enableCamelHumps) {
            results = this.mergeWithCamelHumps(results, filteredItems, query);
        }

        // 2.5 Add URL matches if query looks like a path
        if (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) {
            results = this.mergeWithUrlMatches(results, filteredItems, query);
        }

        // 3. Sort by score
        results.sort((a, b) => b.score - a.score);

        // 4. Boost by activity and re-sort final time
        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
            results.sort((a, b) => b.score - a.score);
        }

        return results.slice(0, maxResults);
    }

    private mergeWithUrlMatches(results: SearchResult[], items: PreparedItem[], query: string): SearchResult[] {
        if (!RouteMatcher.isPotentialUrl(query)) {
            return results;
        }

        const existingIds = new Set(results.map((r) => r.item.id));
        const urlMatches: SearchResult[] = [];

        for (const { item } of items) {
            if (item.type === SearchItemType.ENDPOINT && !existingIds.has(item.id)) {
                if (RouteMatcher.isMatch(item.name, query)) {
                    urlMatches.push({
                        item,
                        score: 1.5, // Ultra high boost for exact URL match
                        scope: SearchScope.ENDPOINTS,
                    });
                }
            }
        }

        return [...results, ...urlMatches];
    }

    private mergeWithCamelHumps(results: SearchResult[], items: PreparedItem[], query: string): SearchResult[] {
        const camelHumpsResults = this.camelHumpsSearch(items, query);
        const existingIds = new Set(results.map((r) => r.item.id));

        for (const res of camelHumpsResults) {
            if (!existingIds.has(res.item.id)) {
                results.push(res);
                existingIds.add(res.item.id);
            }
        }
        return results;
    }

    private applyPersonalizedBoosting(results: SearchResult[]): void {
        if (!this.getActivityScore) {
            return;
        }

        for (const result of results) {
            const activityScore = this.getActivityScore(result.item.id);
            if (activityScore > 0) {
                // ONLY boost if we have a decent base match.
                // This prevents "frequently used" but "totally unrelated" items from appearing.
                const baseScore = result.score;
                if (baseScore > 0.05) {
                    // Blend fuzzy score with activity score
                    result.score = baseScore * (1 - this.activityWeight) + activityScore * this.activityWeight;
                }
            }
        }
    }

    /**
     * Filter items by search scope - NOW O(1) using Hot-Arrays
     */
    private filterByScope(scope: SearchScope): PreparedItem[] {
        return this.scopedItems.get(scope) || this.preparedItems;
    }

    /**
     * Fuzzy search using fuzzysort library
     */
    private fuzzySearch(items: PreparedItem[], query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const MIN_SCORE = 0.01; // Minimum score to be considered a match

        for (const { item, preparedName, preparedFullName, preparedPath, preparedCombined } of items) {
            const score = this.calculateItemScore(
                query,
                preparedName,
                preparedFullName,
                preparedPath,
                preparedCombined,
                MIN_SCORE,
            );

            if (score > MIN_SCORE) {
                results.push({
                    item,
                    score: this.applyItemTypeBoost(score, item.type),
                    scope: this.getScopeForItemType(item.type),
                });
            }
        }

        return results;
    }

    /**
     * Calculate the best fuzzy score for an item
     */
    private calculateItemScore(
        query: string,
        preparedName: Fuzzysort.Prepared,
        preparedFullName: Fuzzysort.Prepared | null,
        preparedPath: Fuzzysort.Prepared | null,
        preparedCombined: Fuzzysort.Prepared | null,
        minScore: number,
    ): number {
        const matches = [
            { prep: preparedName, weight: 1.0 },
            { prep: preparedFullName, weight: 0.9 },
            { prep: preparedPath, weight: 0.8 },
            { prep: preparedCombined, weight: 0.95 },
        ];

        let bestScore = -Infinity;

        for (const match of matches) {
            if (!match.prep) {
                continue;
            }

            const result = Fuzzysort.single(query, match.prep);
            if (result && result.score > minScore) {
                const score = result.score * match.weight;
                if (score > bestScore) {
                    bestScore = score;
                }
            }
        }

        return bestScore;
    }

    /**
     * CamelHumps search (e.g., "RFC" matches "React.FC" or "RequestForComment")
     */
    private camelHumpsSearch(items: PreparedItem[], query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const queryUpper = query.toUpperCase();

        for (const { item } of items) {
            const score = this.camelHumpsMatch(item.name, queryUpper);
            if (score > 0) {
                results.push({
                    item,
                    score: this.applyItemTypeBoost(score, item.type),
                    scope: this.getScopeForItemType(item.type),
                });
            }
        }

        return results;
    }

    /**
     * Calculate CamelHumps match score
     */
    private camelHumpsMatch(text: string, query: string): number {
        // Extract capital letters and first letter
        const capitals = text.charAt(0) + text.slice(1).replace(/[^A-Z]/g, '');

        if (capitals.toUpperCase().includes(query)) {
            // Calculate score based on match position and length
            const matchIndex = capitals.toUpperCase().indexOf(query);
            const lengthRatio = query.length / capitals.length;

            // Boost score if match is at the beginning
            const positionBoost = matchIndex === 0 ? 1.5 : 1.0;

            return lengthRatio * positionBoost * 0.8; // Max score of 0.8 for CamelHumps
        }

        return 0;
    }

    /**
     * Normalize fuzzysort score to 0-1 range
     * Note: Fuzzysort 3.1.0+ already returns scores in 0-1 range
     */
    private normalizeFuzzysortScore(score: number): number {
        return Math.max(0, Math.min(1, score));
    }

    /**
     * Apply boost to score based on item type
     * Types > Symbols > Files > Text
     */
    private applyItemTypeBoost(score: number, type: SearchItemType): number {
        const boosts: Record<SearchItemType, number> = {
            [SearchItemType.CLASS]: 1.5,
            [SearchItemType.INTERFACE]: 1.35,
            [SearchItemType.ENUM]: 1.3,
            [SearchItemType.FUNCTION]: 1.25,
            [SearchItemType.METHOD]: 1.25,
            [SearchItemType.PROPERTY]: 1.1,
            [SearchItemType.VARIABLE]: 1.0,
            [SearchItemType.FILE]: 0.9,
            [SearchItemType.TEXT]: 0.7,
            [SearchItemType.COMMAND]: 1.2,
            [SearchItemType.ENDPOINT]: 1.4,
        };

        return score * (boosts[type] || 1.0);
    }

    /**
     * Get scope for item type
     */
    private getScopeForItemType(type: SearchItemType): SearchScope {
        switch (type) {
            case SearchItemType.CLASS:
            case SearchItemType.INTERFACE:
            case SearchItemType.ENUM:
                return SearchScope.TYPES;
            case SearchItemType.FUNCTION:
            case SearchItemType.METHOD:
                return SearchScope.SYMBOLS;
            case SearchItemType.PROPERTY:
            case SearchItemType.VARIABLE:
                return SearchScope.PROPERTIES;
            case SearchItemType.FILE:
                return SearchScope.FILES;
            case SearchItemType.TEXT:
                return SearchScope.TEXT;
            case SearchItemType.COMMAND:
                return SearchScope.COMMANDS;
            case SearchItemType.ENDPOINT:
                return SearchScope.ENDPOINTS;
            default:
                return SearchScope.EVERYTHING;
        }
    }

    /**
     * Perform an ultra-fast burst search (prefix/exact match) for immediate UI feedback
     */
    burstSearch(options: SearchOptions): SearchResult[] {
        const { query, scope, maxResults = 10 } = options;
        if (!query || query.trim().length === 0) {
            return [];
        }

        const filteredItems = this.filterByScope(scope);
        const results: SearchResult[] = this.findBurstMatches(filteredItems, query.toLowerCase(), maxResults);

        // Add URL matching to burst search for instant feedback
        if (
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) &&
            RouteMatcher.isPotentialUrl(query.toLowerCase())
        ) {
            this.addUrlMatches(results, filteredItems, query.toLowerCase(), maxResults);
        }

        // Apply activity tracking if available
        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
        }

        return results.sort((a, b) => b.score - a.score);
    }

    private findBurstMatches(items: PreparedItem[], queryLower: string, maxResults: number): SearchResult[] {
        const results: SearchResult[] = [];
        for (const { item } of items) {
            const nameLower = item.name.toLowerCase();

            // Priority matches: Exact name or StartsWith
            if (nameLower === queryLower || nameLower.startsWith(queryLower)) {
                results.push({
                    item,
                    score: this.applyItemTypeBoost(1.0, item.type),
                    scope: this.getScopeForItemType(item.type),
                });
            }

            if (results.length >= maxResults) {
                break;
            }
        }
        return results;
    }

    private addUrlMatches(
        results: SearchResult[],
        items: PreparedItem[],
        queryLower: string,
        maxResults: number,
    ): void {
        const existingIds = new Set(results.map((r) => r.item.id));

        for (const { item } of items) {
            if (results.length >= maxResults) {
                break;
            }

            if (item.type === SearchItemType.ENDPOINT && !existingIds.has(item.id)) {
                if (RouteMatcher.isMatch(item.name, queryLower)) {
                    results.push({
                        item,
                        score: 2.0, // Top priority
                        scope: SearchScope.ENDPOINTS,
                    });
                    existingIds.add(item.id);
                }
            }
        }
    }
}
