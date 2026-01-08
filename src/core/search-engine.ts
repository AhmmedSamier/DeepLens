import * as Fuzzysort from 'fuzzysort';
import { SearchableItem, SearchResult, SearchOptions, SearchScope, SearchItemType } from './types';

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine {
    private items: SearchableItem[] = [];
    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;

    /**
     * Set the searchable items
     */
    setItems(items: SearchableItem[]): void {
        this.items = items;
    }

    /**
     * Add items to the search index
     */
    addItems(items: SearchableItem[]): void {
        this.items.push(...items);
    }

    /**
     * Remove items from a specific file
     */
    removeItemsByFile(filePath: string): void {
        this.items = this.items.filter((item) => item.filePath !== filePath);
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

        // Filter items by scope
        let filteredItems = this.filterByScope(this.items, scope);

        // Perform fuzzy search
        let results = this.fuzzySearch(filteredItems, query, maxResults);

        // If CamelHumps is enabled and we have few results, try CamelHumps matching
        if (enableCamelHumps && results.length < maxResults / 2) {
            const camelHumpsResults = this.camelHumpsSearch(filteredItems, query, maxResults);
            // Merge results, avoiding duplicates
            const existingIds = new Set(results.map((r) => r.item.id));
            for (const result of camelHumpsResults) {
                if (!existingIds.has(result.item.id)) {
                    results.push(result);
                    existingIds.add(result.item.id);
                }
            }
        }

        // Sort by score (descending) and apply max results
        results.sort((a, b) => b.score - a.score);

        // Apply activity boosting if enabled
        if (this.getActivityScore) {
            for (const result of results) {
                const activityScore = this.getActivityScore(result.item.id);
                if (activityScore > 0) {
                    // Blend fuzzy score with activity score
                    result.score = (result.score * (1 - this.activityWeight)) + (activityScore * this.activityWeight);
                }
            }
            // Re-sort after applying activity boost
            results.sort((a, b) => b.score - a.score);
        }

        return results.slice(0, maxResults);
    }

    /**
     * Filter items by search scope
     */
    private filterByScope(items: SearchableItem[], scope: SearchScope): SearchableItem[] {
        switch (scope) {
            case SearchScope.TYPES:
                return items.filter(
                    (item) =>
                        item.type === SearchItemType.CLASS ||
                        item.type === SearchItemType.INTERFACE ||
                        item.type === SearchItemType.ENUM
                );
            case SearchScope.SYMBOLS:
                return items.filter(
                    (item) =>
                        item.type === SearchItemType.FUNCTION ||
                        item.type === SearchItemType.METHOD ||
                        item.type === SearchItemType.PROPERTY ||
                        item.type === SearchItemType.VARIABLE
                );
            case SearchScope.FILES:
                return items.filter((item) => item.type === SearchItemType.FILE);
            case SearchScope.COMMANDS:
                return items.filter((item) => item.type === SearchItemType.COMMAND);
            case SearchScope.TEXT:
                return items.filter((item) => item.type === SearchItemType.TEXT);
            case SearchScope.EVERYTHING:
            default:
                return items;
        }
    }

    /**
     * Fuzzy search using fuzzysort library
     */
    private fuzzySearch(items: SearchableItem[], query: string, maxResults: number): SearchResult[] {
        // Prepare items for fuzzysort
        const preparedItems = items.map((item) => ({
            item,
            preparedName: Fuzzysort.prepare(item.name),
            preparedFullName: item.fullName ? Fuzzysort.prepare(item.fullName) : null,
        }));

        // Search by name and fullName
        const results: SearchResult[] = [];

        for (const { item, preparedName, preparedFullName } of preparedItems) {
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
                    bestScore = fullNameResult.score * 0.9; // Slight penalty for full name match
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
    private camelHumpsSearch(items: SearchableItem[], query: string, maxResults: number): SearchResult[] {
        const results: SearchResult[] = [];
        const queryUpper = query.toUpperCase();

        for (const item of items) {
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
        // Typical range is -1000 to 0
        const normalized = Math.max(0, (score + 1000) / 1000);
        return Math.min(1, normalized);
    }

    /**
     * Apply boost to score based on item type
     * Types > Symbols > Files > Text
     */
    private applyItemTypeBoost(score: number, type: SearchItemType): number {
        const boosts: Record<SearchItemType, number> = {
            [SearchItemType.CLASS]: 1.3,
            [SearchItemType.INTERFACE]: 1.3,
            [SearchItemType.ENUM]: 1.2,
            [SearchItemType.FUNCTION]: 1.1,
            [SearchItemType.METHOD]: 1.1,
            [SearchItemType.PROPERTY]: 1.0,
            [SearchItemType.VARIABLE]: 0.9,
            [SearchItemType.FILE]: 0.8,
            [SearchItemType.TEXT]: 0.7,
            [SearchItemType.COMMAND]: 1.2,
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
            default:
                return SearchScope.EVERYTHING;
        }
    }
}
