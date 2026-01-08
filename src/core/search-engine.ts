import * as Fuzzysort from 'fuzzysort';
import { SearchableItem, SearchResult, SearchOptions, SearchScope, SearchItemType } from './types';

interface PreparedItem {
    item: SearchableItem;
    preparedName: Fuzzysort.Prepared;
    preparedFullName: Fuzzysort.Prepared | null;
}

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine {
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
        this.preparedItems = this.items.map(item => ({
            item,
            preparedName: Fuzzysort.prepare(item.name),
            preparedFullName: item.fullName ? Fuzzysort.prepare(item.fullName) : null
        }));

        // Initialize arrays
        for (const scope of Object.values(SearchScope)) {
            if (typeof scope === 'number') {
                this.scopedItems.set(scope, []);
            }
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
     * Perform search
     */
    search(options: SearchOptions): SearchResult[] {
        const { query, scope, maxResults = 50, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) {
            return [];
        }

        // 1. Filter and search - NOW ULTRA FAST using Hot-Arrays
        const filteredItems = this.filterByScope(scope);
        let results = this.fuzzySearch(filteredItems, query, maxResults);

        // 2. Add CamelHumps results if needed
        if (enableCamelHumps && results.length < maxResults / 2) {
            results = this.mergeWithCamelHumps(results, filteredItems, query, maxResults);
        }

        // 3. Sort and return
        results.sort((a, b) => b.score - a.score);

        // 4. Boost by activity and re-sort final time
        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
        }

        results.sort((a, b) => b.score - a.score);

        return results.slice(0, maxResults);
    }

    private mergeWithCamelHumps(results: SearchResult[], items: PreparedItem[], query: string, maxResults: number): SearchResult[] {
        const camelHumpsResults = this.camelHumpsSearch(items, query, maxResults);
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
        if (!this.getActivityScore) return;

        for (const result of results) {
            const activityScore = this.getActivityScore(result.item.id);
            if (activityScore > 0) {
                // Blend fuzzy score with activity score
                result.score = (result.score * (1 - this.activityWeight)) + (activityScore * this.activityWeight);
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
    private fuzzySearch(items: PreparedItem[], query: string, maxResults: number): SearchResult[] {
        // Search by name and fullName
        const results: SearchResult[] = [];

        for (const { item, preparedName, preparedFullName } of items) {
            let bestScore = -Infinity;

            // Match against name
            const nameResult = Fuzzysort.single(query, preparedName);
            if (nameResult && nameResult.score > bestScore) {
                bestScore = nameResult.score;
            }

            // Match against full name if available
            if (preparedFullName) {
                const fullNameResult = Fuzzysort.single(query, preparedFullName);
                if (fullNameResult && fullNameResult.score > bestScore) {
                    // Penalty for full name match (scores are negative, so 1.1 makes it more negative/worse)
                    bestScore = fullNameResult.score * 1.1;
                }
            }

            if (bestScore > -Infinity) {
                // Normalize score to 0-1 range
                const normalizedScore = this.normalizeFuzzysortScore(bestScore);
                results.push({
                    item,
                    score: this.applyItemTypeBoost(normalizedScore, item.type),
                    scope: this.getScopeForItemType(item.type),
                });
            }
        }

        return results;
    }

    /**
     * CamelHumps search (e.g., "RFC" matches "React.FC" or "RequestForComment")
     */
    private camelHumpsSearch(items: PreparedItem[], query: string, maxResults: number): SearchResult[] {
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
     */
    private normalizeFuzzysortScore(score: number): number {
        // Fuzzysort scores are negative (better matches are closer to 0)
        // Range 10,000 allows for deep subsequence matches in long paths
        const range = 10000;
        const normalized = Math.max(0, (score + range) / range);
        return Math.min(1, normalized);
    }

    /**
     * Apply boost to score based on item type
     * Types > Symbols > Files > Text
     */
    private applyItemTypeBoost(score: number, type: SearchItemType): number {
        const boosts: Record<SearchItemType, number> = {
            [SearchItemType.CLASS]: 1.4,
            [SearchItemType.INTERFACE]: 1.4,
            [SearchItemType.ENUM]: 1.3,
            [SearchItemType.FUNCTION]: 1.25,
            [SearchItemType.METHOD]: 1.25,
            [SearchItemType.PROPERTY]: 1.1,
            [SearchItemType.VARIABLE]: 1.0,
            [SearchItemType.FILE]: 0.8,
            [SearchItemType.TEXT]: 0.7,
            [SearchItemType.COMMAND]: 1.3,
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
            case SearchItemType.PROPERTY:
            case SearchItemType.VARIABLE:
                return SearchScope.SYMBOLS;
            case SearchItemType.FILE:
                return SearchScope.FILES;
            case SearchItemType.TEXT:
                return SearchScope.TEXT;
            case SearchItemType.COMMAND:
                return SearchScope.COMMANDS;
            default:
                return SearchScope.EVERYTHING;
        }
    }

    /**
     * Perform an ultra-fast burst search (prefix/exact match) for immediate UI feedback
     */
    burstSearch(options: SearchOptions): SearchResult[] {
        const { query, scope, maxResults = 10 } = options;
        if (!query || query.trim().length === 0) return [];

        const filteredItems = this.filterByScope(scope);
        const results: SearchResult[] = [];
        const queryLower = query.toLowerCase();

        for (const { item } of filteredItems) {
            const nameLower = item.name.toLowerCase();

            // Priority matches: Exact name or StartsWith
            if (nameLower === queryLower || nameLower.startsWith(queryLower)) {
                results.push({
                    item,
                    score: this.applyItemTypeBoost(1.0, item.type),
                    scope: this.getScopeForItemType(item.type),
                });
            }

            if (results.length >= maxResults) break;
        }

        // Apply activity tracking if available
        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
        }

        return results.sort((a, b) => b.score - a.score);
    }
}
