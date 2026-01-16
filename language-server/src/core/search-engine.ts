import * as Fuzzysort from 'fuzzysort';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
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
    private itemsMap: Map<string, SearchableItem> = new Map();
    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;
    private config?: Config;
    private logger?: { log: (msg: string) => void; error: (msg: string) => void };
    private activeFiles: Set<string> = new Set();

    /**
     * Set logger
     */
    setLogger(logger: { log: (msg: string) => void; error: (msg: string) => void }): void {
        this.logger = logger;
    }

    /**
     * Set configuration
     */
    setConfig(config: Config): void {
        this.config = config;
    }

    /**
     * Set the searchable items and update hot-arrays
     */
    setItems(items: SearchableItem[]): void {
        this.items = items;
        this.itemsMap.clear();
        for (const item of items) {
            this.itemsMap.set(item.id, item);
        }
        this.rebuildHotArrays();
    }

    /**
     * Add items to the search index and update hot-arrays
     */
    addItems(items: SearchableItem[]): void {
        this.items.push(...items);
        for (const item of items) {
            this.itemsMap.set(item.id, item);
        }
        this.rebuildHotArrays();
    }

    /**
     * Remove items from a specific file and update hot-arrays
     */
    removeItemsByFile(filePath: string): void {
        const newItems: SearchableItem[] = [];
        for (const item of this.items) {
            if (item.filePath !== filePath) {
                newItems.push(item);
            } else {
                this.itemsMap.delete(item.id);
            }
        }
        this.items = newItems;
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
     * Set the list of currently active or open files to prioritize them
     */
    setActiveFiles(files: string[]): void {
        this.activeFiles = new Set(files.map(f => path.normalize(f)));
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.items = [];
        this.itemsMap.clear();
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
    async search(options: SearchOptions, onResult?: (result: SearchResult) => void): Promise<SearchResult[]> {
        const { query, scope, maxResults = 50, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) {
            return [];
        }

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        // If effectiveQuery is empty after stripping line number, return empty
        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        // Special handling for text search
        if (scope === SearchScope.TEXT && this.config?.isTextSearchEnabled()) {
            return this.performTextSearch(effectiveQuery, maxResults, onResult);
        }

        // 1. Filter and search - NOW ULTRA FAST using Hot-Arrays
        const filteredItems = this.filterByScope(scope);
        let results = this.fuzzySearch(filteredItems, effectiveQuery);

        // 2. Add CamelHumps results if enabled
        if (enableCamelHumps) {
            results = this.mergeWithCamelHumps(results, filteredItems, effectiveQuery);
        }

        // 2.5 Add URL matches if query looks like a path
        if (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) {
            results = this.mergeWithUrlMatches(results, filteredItems, effectiveQuery);
        }


        // 3. Sort by score
        results.sort((a, b) => b.score - a.score);

        // 4. Boost by activity and re-sort final time
        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
            results.sort((a, b) => b.score - a.score);
        }

        // Apply target line if found
        if (targetLine !== undefined) {
            results = results.map((r) => ({
                ...r,
                item: {
                    ...r.item,
                    line: targetLine,
                },
            }));
        }

        return results.slice(0, maxResults);
    }

    /**
     * Perform grep-like text search on indexed files
     */
    private async performTextSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): Promise<SearchResult[]> {
        const startTime = Date.now();
        this.logger?.log(`--- Starting LSP Text Search: "${query}" ---`);
        const results: SearchResult[] = [];
        const fileItems = this.items.filter((item) => item.type === SearchItemType.FILE);
        const queryLower = query.toLowerCase();

        // Zed Optimization: Prioritize active/open files
        const prioritizedFiles = fileItems.sort((a, b) => {
            const aActive = this.activeFiles.has(path.normalize(a.filePath)) ? 1 : 0;
            const bActive = this.activeFiles.has(path.normalize(b.filePath)) ? 1 : 0;
            return bActive - aActive;
        });

        // Limit concurrency
        const CONCURRENCY = this.config?.getSearchConcurrency() || 60;
        const chunks: SearchableItem[][] = [];
        for (let i = 0; i < prioritizedFiles.length; i += CONCURRENCY) {
            chunks.push(prioritizedFiles.slice(i, i + CONCURRENCY));
        }

        let processedFiles = 0;
        let pendingResults: SearchResult[] = [];
        let firstResultTime: number | null = null;

        const flushBatch = () => {
            if (pendingResults.length > 0) {
                if (firstResultTime === null) {
                    firstResultTime = Date.now() - startTime;
                }
                if (onResult) {
                    pendingResults.forEach((r) => onResult(r));
                }
                pendingResults = [];
            }
        };

        for (const chunk of chunks) {
            if (results.length >= maxResults) break;

            await Promise.all(
                chunk.map(async (fileItem) => {
                    if (results.length >= maxResults) return;

                    try {
                        const stats = await fs.promises.stat(fileItem.filePath);
                        if (stats.size > 5 * 1024 * 1024) return;

                        const content = await fs.promises.readFile(fileItem.filePath, 'utf8');
                        processedFiles++;

                        if (!content.toLowerCase().includes(queryLower)) return;

                        let lineStart = 0;
                        let lineIndex = 0;
                        while (lineStart < content.length) {
                            if (results.length >= maxResults) break;

                            let nextNewline = content.indexOf('\n', lineStart);
                            if (nextNewline === -1) nextNewline = content.length;

                            const lineText = content.substring(lineStart, nextNewline);
                            const matchIndex = lineText.toLowerCase().indexOf(queryLower);

                            if (matchIndex >= 0) {
                                const trimmedLine = lineText.trim();
                                if (trimmedLine.length > 0) {
                                    const result: SearchResult = {
                                        item: {
                                            id: `text:${fileItem.filePath}:${lineIndex}:${matchIndex}`,
                                            name: trimmedLine,
                                            type: SearchItemType.TEXT,
                                            filePath: fileItem.filePath,
                                            relativeFilePath: fileItem.relativeFilePath,
                                            line: lineIndex,
                                            column: matchIndex,
                                            containerName: fileItem.name,
                                            detail: fileItem.relativeFilePath,
                                        },
                                        score: 1.0,
                                        scope: SearchScope.TEXT,
                                        highlights: [[matchIndex, matchIndex + query.length]],
                                    };

                                    results.push(result);
                                    pendingResults.push(result);
                                    if (pendingResults.length >= 5) {
                                        flushBatch();
                                    }
                                }
                            }

                            lineStart = nextNewline + 1;
                            lineIndex++;
                        }
                    } catch (error) {
                        // Ignore read/stat errors
                    }
                })
            );

            if (processedFiles % 100 === 0 || results.length > 0) {
                this.logger?.log(`Searched ${processedFiles}/${fileItems.length} files... found ${results.length} matches`);
            }
            flushBatch();
        }

        flushBatch();
        const durationMs = Date.now() - startTime;
        const durationSec = (durationMs / 1000).toFixed(3);
        const firstResultLog = firstResultTime !== null ? ` (First result in ${firstResultTime}ms)` : '';

        this.logger?.log(`Text search completed in ${durationSec}s${firstResultLog}. Found ${results.length} results.`);
        return results;
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
                        score: 1.5,
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
                const baseScore = result.score;
                if (baseScore > 0.05) {
                    result.score = baseScore * (1 - this.activityWeight) + activityScore * this.activityWeight;
                }
            }
        }
    }

    private filterByScope(scope: SearchScope): PreparedItem[] {
        return this.scopedItems.get(scope) || this.preparedItems;
    }

    private fuzzySearch(items: PreparedItem[], query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const MIN_SCORE = 0.01;

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

    private camelHumpsMatch(text: string, query: string): number {
        const capitals = text.charAt(0) + text.slice(1).replace(/[^A-Z]/g, '');

        if (capitals.toUpperCase().includes(query)) {
            const matchIndex = capitals.toUpperCase().indexOf(query);
            const lengthRatio = query.length / capitals.length;
            const positionBoost = matchIndex === 0 ? 1.5 : 1.0;
            return lengthRatio * positionBoost * 0.8;
        }

        return 0;
    }

    private normalizeFuzzysortScore(score: number): number {
        return Math.max(0, Math.min(1, score));
    }

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

    resolveItems(itemIds: string[]): SearchResult[] {
        const results: SearchResult[] = [];
        for (const id of itemIds) {
            const item = this.itemsMap.get(id);
            if (item) {
                results.push({
                    item,
                    score: 1.0,
                    scope: this.getScopeForItemType(item.type),
                });
            }
        }
        return results;
    }

    burstSearch(options: SearchOptions, onResult?: (result: SearchResult) => void): SearchResult[] {
        const { query, scope, maxResults = 10 } = options;
        if (!query || query.trim().length === 0) {
            return [];
        }

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        const filteredItems = this.filterByScope(scope);
        let results: SearchResult[] = this.findBurstMatches(
            filteredItems,
            effectiveQuery.toLowerCase(),
            maxResults,
            onResult,
        );

        if (
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) &&
            RouteMatcher.isPotentialUrl(effectiveQuery.toLowerCase())
        ) {
            this.addUrlMatches(results, filteredItems, effectiveQuery.toLowerCase(), maxResults);
        }

        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
        }

        if (targetLine !== undefined) {
            results = results.map((r) => ({
                ...r,
                item: {
                    ...r.item,
                    line: targetLine,
                },
            }));
        }

        return results.sort((a, b) => b.score - a.score);
    }

    private findBurstMatches(
        items: PreparedItem[],
        queryLower: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): SearchResult[] {
        const results: SearchResult[] = [];
        for (const { item } of items) {
            const nameLower = item.name.toLowerCase();

            if (nameLower === queryLower || nameLower.startsWith(queryLower)) {
                const result: SearchResult = {
                    item,
                    score: this.applyItemTypeBoost(1.0, item.type),
                    scope: this.getScopeForItemType(item.type),
                };
                results.push(result);
                if (onResult) {
                    onResult(result);
                }
            }

            if (results.length >= maxResults) {
                break;
            }
        }
        return results;
    }

    private parseQueryWithLineNumber(query: string): { effectiveQuery: string; targetLine?: number } {
        const lineMatch = query.match(/^(.*?):(\d+)$/);
        if (lineMatch) {
            const effectiveQuery = lineMatch[1];
            const line = parseInt(lineMatch[2], 10);
            return {
                effectiveQuery,
                targetLine: line > 0 ? line - 1 : undefined,
            };
        }
        return { effectiveQuery: query };
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
                        score: 2.0,
                        scope: SearchScope.ENDPOINTS,
                    });
                    existingIds.add(item.id);
                }
            }
        }
    }

    getRecentItems(count: number): SearchResult[] {
        return [];
    }

    recordActivity(itemId: string): void {
        // No-op
    }
}
