import * as Fuzzysort from 'fuzzysort';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { RouteMatcher } from './route-matcher';
import { SearchableItem, SearchItemType, SearchOptions, SearchResult, SearchScope } from './types';
import { ISearchProvider } from './search-interface';
import { RipgrepService } from './ripgrep-service';
import { MinHeap } from './min-heap';

const ITEM_TYPE_BOOSTS: Record<SearchItemType, number> = {
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

// Map string enums to integers for Uint8Array storage
const TYPE_KEYS = Object.values(SearchItemType);
const TYPE_TO_ID: Record<string, number> = {};
TYPE_KEYS.forEach((key, index) => TYPE_TO_ID[key] = index);

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 * Refactored to use Struct of Arrays (Flyweight) pattern for memory optimization.
 */
export class SearchEngine implements ISearchProvider {
    // Component Arrays (Flyweight Storage)
    private ids: string[] = [];
    private names: string[] = [];
    private itemTypes: Uint8Array = new Uint8Array(0);
    private itemFileIds: Uint32Array = new Uint32Array(0); // Index into uniqueFiles
    private itemLines: Int32Array = new Int32Array(0);     // -1 if undefined
    private itemColumns: Int32Array = new Int32Array(0);   // -1 if undefined

    // Sparse arrays for optional fields (store null if missing to save string memory, though array overhead exists)
    private itemFullNames: (string | null)[] = [];
    private itemContainerNames: (string | null)[] = [];
    private itemDetails: (string | null)[] = [];
    private itemCommandIds: (string | null)[] = [];

    // Parallel Prepared Arrays
    private preparedNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedNamesLow: (string | null)[] = [];
    private preparedFullNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedPaths: (Fuzzysort.Prepared | null)[] = [];
    private preparedCapitals: (string | null)[] = [];

    // File Deduplication
    private uniqueFiles: { path: string; relative: string | undefined }[] = [];
    private uniqueFileMap: Map<string, number> = new Map(); // path -> index in uniqueFiles

    // ID Lookup for O(1) access
    private idToIndex: Map<string, number> = new Map();

    private itemCount: number = 0;

    // Deduplication cache for prepared strings
    private preparedCache: Map<string, Fuzzysort.Prepared> = new Map();
    private preparedLowCache: Map<string, string> = new Map();
    private removedSinceLastPrune: number = 0;

    // Map Scope -> Array of Indices
    private scopedIndices: Map<SearchScope, number[]> = new Map();

    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;
    private config?: Config;
    private logger?: { log: (msg: string) => void; error: (msg: string) => void };
    private activeFiles: Set<string> = new Set();
    private ripgrep: RipgrepService | undefined;

    setLogger(logger: { log: (msg: string) => void; error: (msg: string) => void }): void {
        this.logger = logger;
    }

    setConfig(config: Config): void {
        this.config = config;
    }

    setExtensionPath(extensionPath: string): void {
        this.ripgrep = new RipgrepService(extensionPath);
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
     * Set the searchable items and update hot-arrays.
     * Replaces all existing items.
     */
    setItems(items: SearchableItem[]): void {
        this.clear();
        this.addItems(items);
    }

    /**
     * Add items to the search index and update hot-arrays incrementally.
     */
    addItems(items: SearchableItem[]): void {
        const count = items.length;
        if (count === 0) return;

        const startIndex = this.itemCount;
        const newTotal = startIndex + count;

        // Resize TypedArrays if necessary
        this.ensureCapacity(newTotal);

        for (let i = 0; i < count; i++) {
            const item = items[i];
            const globalIndex = startIndex + i;

            // 1. Store Component Data
            this.ids.push(item.id);
            this.names.push(item.name);
            this.idToIndex.set(item.id, globalIndex);

            // Type
            const typeId = TYPE_TO_ID[item.type];
            this.itemTypes[globalIndex] = typeId !== undefined ? typeId : 0;

            // File Path Deduplication
            let fileId = this.uniqueFileMap.get(item.filePath);
            if (fileId === undefined) {
                fileId = this.uniqueFiles.length;
                this.uniqueFiles.push({ path: item.filePath, relative: item.relativeFilePath });
                this.uniqueFileMap.set(item.filePath, fileId);
            }
            this.itemFileIds[globalIndex] = fileId;

            // Line/Column
            this.itemLines[globalIndex] = item.line !== undefined ? item.line : -1;
            this.itemColumns[globalIndex] = item.column !== undefined ? item.column : -1;

            // Optional String Fields
            this.itemFullNames.push(item.fullName || null);
            this.itemContainerNames.push(item.containerName || null);
            this.itemDetails.push(item.detail || null);
            this.itemCommandIds.push(item.commandId || null);

            // 2. Prepare Fuzzysort Data
            const normalizedPath = item.relativeFilePath ? item.relativeFilePath.replace(/\\/g, '/') : null;
            const shouldPrepareFullName =
                item.fullName && item.fullName !== item.name && item.fullName !== item.relativeFilePath;

            this.preparedNames.push(this.getPrepared(item.name));
            this.preparedNamesLow.push(this.getPreparedLow(item.name));
            this.preparedFullNames.push(
                shouldPrepareFullName && item.fullName ? this.getPrepared(item.fullName) : null
            );
            this.preparedPaths.push(
                normalizedPath ? this.getPrepared(normalizedPath) : null
            );
            this.preparedCapitals.push(this.extractCapitals(item.name));

            // 3. Update Scopes
            const scope = this.getScopeForItemType(item.type);
            let indices = this.scopedIndices.get(scope);
            if (!indices) {
                indices = [];
                this.scopedIndices.set(scope, indices);
            }
            indices.push(globalIndex);
        }

        this.itemCount = newTotal;
    }

    private ensureCapacity(minCapacity: number): void {
        if (this.itemTypes.length >= minCapacity) return;

        // Grow by 1.5x or minCapacity
        const newCapacity = Math.max(minCapacity, Math.ceil(this.itemTypes.length * 1.5));

        const newTypes = new Uint8Array(newCapacity);
        newTypes.set(this.itemTypes);
        this.itemTypes = newTypes;

        const newFileIds = new Uint32Array(newCapacity);
        newFileIds.set(this.itemFileIds);
        this.itemFileIds = newFileIds;

        const newLines = new Int32Array(newCapacity);
        newLines.set(this.itemLines);
        this.itemLines = newLines;

        const newColumns = new Int32Array(newCapacity);
        newColumns.set(this.itemColumns);
        this.itemColumns = newColumns;
    }

    /**
     * Reconstruct a SearchableItem from the component arrays.
     */
    private reconstructItem(index: number): SearchableItem {
        const type = TYPE_KEYS[this.itemTypes[index]] as SearchItemType;
        const fileInfo = this.uniqueFiles[this.itemFileIds[index]];

        const line = this.itemLines[index];
        const column = this.itemColumns[index];

        const item: SearchableItem = {
            id: this.ids[index],
            name: this.names[index],
            type,
            filePath: fileInfo.path,
            relativeFilePath: fileInfo.relative,
        };

        if (line !== -1) item.line = line;
        if (column !== -1) item.column = column;

        const fullName = this.itemFullNames[index];
        if (fullName) item.fullName = fullName;

        const containerName = this.itemContainerNames[index];
        if (containerName) item.containerName = containerName;

        const detail = this.itemDetails[index];
        if (detail) item.detail = detail;

        const commandId = this.itemCommandIds[index];
        if (commandId) item.commandId = commandId;

        return item;
    }

    /**
     * Remove items from a specific file.
     * Compacts all arrays in place.
     */
    removeItemsByFile(filePath: string): void {
        const fileIdToRemove = this.uniqueFileMap.get(filePath);
        if (fileIdToRemove === undefined) return;

        let write = 0;
        const count = this.itemCount;

        for (let read = 0; read < count; read++) {
            // Check if this item belongs to the file
            if (this.itemFileIds[read] !== fileIdToRemove) {
                if (read !== write) {
                    // Move data to 'write' position
                    this.ids[write] = this.ids[read];
                    this.names[write] = this.names[read];
                    this.itemTypes[write] = this.itemTypes[read];
                    this.itemFileIds[write] = this.itemFileIds[read];
                    this.itemLines[write] = this.itemLines[read];
                    this.itemColumns[write] = this.itemColumns[read];
                    this.itemFullNames[write] = this.itemFullNames[read];
                    this.itemContainerNames[write] = this.itemContainerNames[read];
                    this.itemDetails[write] = this.itemDetails[read];
                    this.itemCommandIds[write] = this.itemCommandIds[read];

                    // Move prepared data
                    this.preparedNames[write] = this.preparedNames[read];
                    this.preparedNamesLow[write] = this.preparedNamesLow[read];
                    this.preparedFullNames[write] = this.preparedFullNames[read];
                    this.preparedPaths[write] = this.preparedPaths[read];
                    this.preparedCapitals[write] = this.preparedCapitals[read];

                    // Update index map
                    this.idToIndex.set(this.ids[write], write);
                }
                write++;
            } else {
                // Remove from index map
                this.idToIndex.delete(this.ids[read]);
            }
        }

        // Update count
        if (write < count) {
            this.itemCount = write;

            // Truncate standard arrays
            this.ids.length = write;
            this.names.length = write;
            this.itemFullNames.length = write;
            this.itemContainerNames.length = write;
            this.itemDetails.length = write;
            this.itemCommandIds.length = write;

            this.preparedNames.length = write;
            this.preparedNamesLow.length = write;
            this.preparedFullNames.length = write;
            this.preparedPaths.length = write;
            this.preparedCapitals.length = write;

            // TypedArrays are not truncated, but we respect itemCount.
            // We can optionally zero out the tail if needed for GC, but strictly not required for numbers.

            // Clean up the unique file entry?
            // It's hard to remove from uniqueFiles because other items refer to fileIds by index.
            // Removing from uniqueFiles would require re-indexing everything.
            // For now, we leave the file path in uniqueFiles, but remove it from the Map so it can be re-added fresh if needed.
            // Actually, if we re-add the file later, we might create a duplicate entry in uniqueFiles array if we just deleted from Map.
            // But since we can't easily compact uniqueFiles without scanning all items, we'll accept the leak of a string in uniqueFiles array
            // until a full clear/reindex. Or we could just NOT delete from Map and reuse it?
            // If we removeItemsByFile, we assume the file is gone or being re-indexed.
            // If we keep it in Map, re-indexing will reuse the ID. This is GOOD.
            // So we DO NOT delete from uniqueFileMap or uniqueFiles.
            // BUT, if the file is truly deleted, we leak one entry. This is acceptable for Flyweight.

            // Rebuild scope indices
            this.rebuildScopeIndices();

            this.removedSinceLastPrune++;
            if (this.removedSinceLastPrune > 2000 && this.preparedCache.size > 10000) {
                this.pruneCache();
                this.removedSinceLastPrune = 0;
            }
        }
    }

    private pruneCache(): void {
        const usedPrepared = new Set<Fuzzysort.Prepared>();
        // Only scan up to itemCount
        for (let i = 0; i < this.itemCount; i++) {
            const p1 = this.preparedNames[i]; if (p1) usedPrepared.add(p1);
            const p2 = this.preparedFullNames[i]; if (p2) usedPrepared.add(p2);
            const p3 = this.preparedPaths[i]; if (p3) usedPrepared.add(p3);
        }

        for (const [key, prepared] of this.preparedCache) {
            if (!usedPrepared.has(prepared)) {
                this.preparedCache.delete(key);
            }
        }

        if (this.preparedLowCache.size > 20000) {
            this.preparedLowCache.clear();
        }
    }

    private rebuildScopeIndices(): void {
        this.scopedIndices.clear();

        for (const scope of Object.values(SearchScope)) {
            if (scope !== SearchScope.EVERYTHING) {
                this.scopedIndices.set(scope, []);
            }
        }

        for (let i = 0; i < this.itemCount; i++) {
            const type = TYPE_KEYS[this.itemTypes[i]] as SearchItemType;
            const scope = this.getScopeForItemType(type);
            this.scopedIndices.get(scope)?.push(i);
        }
    }

    clear(): void {
        this.ids = [];
        this.names = [];
        this.itemTypes = new Uint8Array(0);
        this.itemFileIds = new Uint32Array(0);
        this.itemLines = new Int32Array(0);
        this.itemColumns = new Int32Array(0);
        this.itemFullNames = [];
        this.itemContainerNames = [];
        this.itemDetails = [];
        this.itemCommandIds = [];
        this.itemCount = 0;

        this.preparedNames = [];
        this.preparedNamesLow = [];
        this.preparedFullNames = [];
        this.preparedPaths = [];
        this.preparedCapitals = [];

        this.uniqueFiles = [];
        this.uniqueFileMap.clear();
        this.idToIndex.clear();
        this.scopedIndices.clear();
        this.preparedCache.clear();
        this.preparedLowCache.clear();
    }

    getItemCount(): number {
        return this.itemCount;
    }

    getStats(): { totalItems: number; fileCount: number; typeCount: number; symbolCount: number } {
        let fileCount = 0;
        let typeCount = 0;
        let symbolCount = 0;

        for (let i = 0; i < this.itemCount; i++) {
            const type = TYPE_KEYS[this.itemTypes[i]] as SearchItemType;
            if (type === SearchItemType.FILE) {
                fileCount++;
            } else if (
                type === SearchItemType.CLASS ||
                type === SearchItemType.INTERFACE ||
                type === SearchItemType.ENUM
            ) {
                typeCount++;
            } else if (
                type === SearchItemType.METHOD ||
                type === SearchItemType.FUNCTION ||
                type === SearchItemType.PROPERTY
            ) {
                symbolCount++;
            }
        }

        return {
            totalItems: this.itemCount,
            fileCount,
            typeCount,
            symbolCount,
        };
    }

    async search(options: SearchOptions, onResult?: (result: SearchResult) => void): Promise<SearchResult[]> {
        const { query, scope, maxResults = 50, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) return [];

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);
        if (effectiveQuery.trim().length === 0) return [];

        if (scope === SearchScope.TEXT && this.config?.isTextSearchEnabled()) {
            return this.performTextSearch(effectiveQuery, maxResults, onResult);
        }

        const normalizedQuery = effectiveQuery.replace(/\\/g, '/');
        const indices = scope === SearchScope.EVERYTHING ? undefined : this.scopedIndices.get(scope);

        let results = this.performUnifiedSearch(
            indices,
            normalizedQuery,
            enableCamelHumps,
            maxResults,
            scope
        );

        if (targetLine !== undefined) {
            results = results.map((r) => ({
                ...r,
                item: { ...r.item, line: targetLine },
            }));
        }

        return results;
    }

    private performUnifiedSearch(
        indices: number[] | undefined,
        query: string,
        enableCamelHumps: boolean,
        maxResults: number,
        scope: SearchScope
    ): SearchResult[] {
        const heap = new MinHeap<SearchResult>(maxResults, (a, b) => a.score - b.score);
        const MIN_SCORE = 0.01;
        const queryUpper = enableCamelHumps ? query.toUpperCase() : '';
        const isPotentialUrl = (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) &&
                               RouteMatcher.isPotentialUrl(query);

        const processIndex = (i: number) => {
            const type = TYPE_KEYS[this.itemTypes[i]] as SearchItemType;
            const name = this.names[i];
            let score = -1;
            let resultScope = this.getScopeForItemType(type);

            // 1. Fuzzy Search
            const fuzzyScore = this.calculateItemScore(
                query,
                this.preparedNames[i],
                this.preparedFullNames[i],
                this.preparedPaths[i],
                MIN_SCORE,
            );

            if (fuzzyScore > MIN_SCORE) {
                score = this.applyItemTypeBoost(fuzzyScore, type);
            } else if (enableCamelHumps) {
                const capitals = this.preparedCapitals[i];
                if (capitals) {
                    const camelScore = this.camelHumpsMatch(capitals, queryUpper);
                    if (camelScore > 0) {
                        score = this.applyItemTypeBoost(camelScore, type);
                    }
                }
            }

            if (isPotentialUrl && type === SearchItemType.ENDPOINT) {
                 if (RouteMatcher.isMatch(name, query)) {
                     const urlScore = 1.5;
                     if (urlScore > score) {
                         score = urlScore;
                         resultScope = SearchScope.ENDPOINTS;
                     }
                 }
            }

            if (score > MIN_SCORE) {
                if (this.getActivityScore) {
                     const activityScore = this.getActivityScore(this.ids[i]);
                     if (activityScore > 0 && score > 0.05) {
                         score = score * (1 - this.activityWeight) + activityScore * this.activityWeight;
                     }
                }

                if (heap.isFull()) {
                    const minItem = heap.peek();
                    if (minItem && score <= minItem.score) return;
                }

                // Reconstruct item only when adding to result
                heap.push({
                    item: this.reconstructItem(i),
                    score,
                    scope: resultScope
                });
            }
        };

        if (indices) {
            for (let k = 0; k < indices.length; k++) processIndex(indices[k]);
        } else {
            for (let i = 0; i < this.itemCount; i++) processIndex(i);
        }

        return heap.getSorted();
    }

    resolveItems(itemIds: string[]): SearchResult[] {
        const results: SearchResult[] = [];
        for (const id of itemIds) {
            const index = this.idToIndex.get(id);
            if (index !== undefined && index < this.itemCount) {
                const item = this.reconstructItem(index);
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
        if (!query || query.trim().length === 0) return [];

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);
        if (effectiveQuery.trim().length === 0) return [];

        const normalizedQuery = effectiveQuery.replace(/\\/g, '/');
        const indices = scope === SearchScope.EVERYTHING ? undefined : this.scopedIndices.get(scope);

        let results: SearchResult[] = this.findBurstMatches(
            indices,
            normalizedQuery.toLowerCase(),
            maxResults,
            onResult,
        );

        if (
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) &&
            RouteMatcher.isPotentialUrl(normalizedQuery.toLowerCase())
        ) {
            this.addUrlMatches(results, indices, normalizedQuery.toLowerCase(), maxResults);
        }

        if (this.getActivityScore) {
            this.applyPersonalizedBoosting(results);
        }

        if (targetLine !== undefined) {
            results = results.map((r) => ({
                ...r,
                item: { ...r.item, line: targetLine },
            }));
        }

        return results.sort((a, b) => b.score - a.score);
    }

    private findBurstMatches(
        indices: number[] | undefined,
        queryLower: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): SearchResult[] {
        const results: SearchResult[] = [];

        const processItem = (i: number) => {
             if (results.length >= maxResults) return;

            const nameLower = this.preparedNamesLow[i] || this.names[i].toLowerCase();

            if (nameLower === queryLower || nameLower.startsWith(queryLower)) {
                const item = this.reconstructItem(i);
                const result: SearchResult = {
                    item,
                    score: this.applyItemTypeBoost(1.0, item.type),
                    scope: this.getScopeForItemType(item.type),
                };
                results.push(result);
                if (onResult) onResult(result);
            }
        };

        if (indices) {
             for (let k = 0; k < indices.length; k++) {
                if (results.length >= maxResults) break;
                processItem(indices[k]);
             }
        } else {
            for (let i = 0; i < this.itemCount; i++) {
                if (results.length >= maxResults) break;
                processItem(i);
            }
        }

        return results;
    }

    private addUrlMatches(
        results: SearchResult[],
        indices: number[] | undefined,
        queryLower: string,
        maxResults?: number,
    ): void {
        const existingIds = new Set(results.map((r) => r.item.id));

        const checkItem = (i: number) => {
             if (maxResults && results.length >= maxResults) return;

             const type = TYPE_KEYS[this.itemTypes[i]] as SearchItemType;
             const id = this.ids[i];

             if (type === SearchItemType.ENDPOINT && !existingIds.has(id)) {
                if (RouteMatcher.isMatch(this.names[i], queryLower)) {
                    results.push({
                        item: this.reconstructItem(i),
                        score: 2.0,
                        scope: SearchScope.ENDPOINTS,
                    });
                    existingIds.add(id);
                }
            }
        };

        if (indices) {
            for (const i of indices) {
                if (maxResults && results.length >= maxResults) break;
                checkItem(i);
            }
        } else {
            for (let i = 0; i < this.itemCount; i++) {
                if (maxResults && results.length >= maxResults) break;
                checkItem(i);
            }
        }
    }

    private applyPersonalizedBoosting(results: SearchResult[]): void {
        if (!this.getActivityScore) return;

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

    // Helper methods for preparing fuzzysort...
    private getPrepared(text: string): Fuzzysort.Prepared {
        let prepared = this.preparedCache.get(text);
        if (!prepared) {
            prepared = Fuzzysort.prepare(text);
            this.preparedCache.set(text, prepared);
        }
        return prepared;
    }

    private getPreparedLow(text: string): string {
        let low = this.preparedLowCache.get(text);
        if (!low) {
            low = text.toLowerCase();
            this.preparedLowCache.set(text, low);
        }
        return low;
    }

    private calculateItemScore(
        query: string,
        preparedName: Fuzzysort.Prepared | null,
        preparedFullName: Fuzzysort.Prepared | null,
        preparedPath: Fuzzysort.Prepared | null,
        minScore: number,
    ): number {
        let bestScore = -Infinity;
        const queryLen = query.length;

        if (preparedName) {
            if (queryLen <= preparedName.target.length) {
                const result = Fuzzysort.single(query, preparedName);
                if (result && result.score > minScore) {
                    const score = result.score;
                    if (score > bestScore) bestScore = score;
                }
            }
        }

        if (bestScore >= 0.9) return bestScore;

        if (preparedFullName) {
            if (queryLen <= preparedFullName.target.length) {
                const result = Fuzzysort.single(query, preparedFullName);
                if (result && result.score > minScore) {
                    const score = result.score * 0.9;
                    if (score > bestScore) bestScore = score;
                }
            }
        }

        if (bestScore >= 0.8) return bestScore;

        if (preparedPath) {
            if (queryLen <= preparedPath.target.length) {
                const result = Fuzzysort.single(query, preparedPath);
                if (result && result.score > minScore) {
                    const score = result.score * 0.8;
                    if (score > bestScore) bestScore = score;
                }
            }
        }

        return bestScore;
    }

    private extractCapitals(text: string): string {
        return (text.charAt(0) + text.slice(1).replace(/[^A-Z]/g, '')).toUpperCase();
    }

    private camelHumpsMatch(capitals: string, query: string): number {
        const matchIndex = capitals.indexOf(query);
        if (matchIndex !== -1) {
            const lengthRatio = query.length / capitals.length;
            const positionBoost = matchIndex === 0 ? 1.5 : 1.0;
            return lengthRatio * positionBoost * 0.8;
        }
        return 0;
    }

    private applyItemTypeBoost(score: number, type: SearchItemType): number {
        return score * (ITEM_TYPE_BOOSTS[type] || 1.0);
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

    private async performTextSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): Promise<SearchResult[]> {
        const startTime = Date.now();
        const allFilePaths = this.uniqueFiles.map(f => f.path);

        if (this.ripgrep && this.ripgrep.isAvailable()) {
            this.logger?.log(`--- Starting LSP Text Search (Ripgrep): "${query}" ---`);
            try {
                const matches = await this.ripgrep.search(query, allFilePaths, maxResults);
                const results: SearchResult[] = [];
                for (const match of matches) {
                    const fileId = this.uniqueFileMap.get(match.path);
                    if (fileId === undefined) continue;
                    const fileInfo = this.uniqueFiles[fileId];

                    const result: SearchResult = {
                        item: {
                            id: `text:${match.path}:${match.line}:${match.column}`,
                            name: match.text,
                            type: SearchItemType.TEXT,
                            filePath: match.path,
                            relativeFilePath: fileInfo.relative,
                            line: match.line,
                            column: match.column,
                            containerName: path.basename(match.path),
                            detail: fileInfo.relative,
                        },
                        score: 1.0,
                        scope: SearchScope.TEXT,
                        highlights: match.submatches.map(sm => [sm.start, sm.end])
                    };
                    results.push(result);
                    if (onResult) onResult(result);
                }
                const durationMs = Date.now() - startTime;
                this.logger?.log(`Ripgrep search completed in ${(durationMs/1000).toFixed(3)}s. Found ${results.length} results.`);
                return results;
            } catch (error) {
                this.logger?.error(`Ripgrep failed: ${error}. Falling back to Node.js stream.`);
            }
        }

        this.logger?.log(`--- Starting LSP Text Search (Streaming): "${query}" ---`);
        const results: SearchResult[] = [];
        const queryLower = query.toLowerCase();

        // Construct temporary items for streaming search
        // We only need the files.
        const fileItems: SearchableItem[] = this.uniqueFiles.map(f => ({
            id: f.path, // Temporary ID
            name: path.basename(f.path),
            type: SearchItemType.FILE,
            filePath: f.path,
            relativeFilePath: f.relative
        }));

        const prioritizedFiles = fileItems.sort((a, b) => {
            const aActive = this.activeFiles.has(path.normalize(a.filePath)) ? 1 : 0;
            const bActive = this.activeFiles.has(path.normalize(b.filePath)) ? 1 : 0;
            return bActive - aActive;
        });

        const CONCURRENCY = this.config?.getSearchConcurrency() || 20;
        const chunks: SearchableItem[][] = [];
        for (let i = 0; i < prioritizedFiles.length; i += CONCURRENCY) {
            chunks.push(prioritizedFiles.slice(i, i + CONCURRENCY));
        }

        let processedFiles = 0;
        let pendingResults: SearchResult[] = [];
        let firstResultTime: number | null = null;

        const flushBatch = () => {
            if (pendingResults.length > 0) {
                if (firstResultTime === null) firstResultTime = Date.now() - startTime;
                if (onResult) pendingResults.forEach((r) => onResult(r));
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
                        processedFiles++;
                        await this.scanFileStream(fileItem, queryLower, query.length, maxResults, results, pendingResults);
                    } catch (error) { }
                })
            );
            if (pendingResults.length >= 5) flushBatch();
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

    private async scanFileStream(
        fileItem: SearchableItem,
        queryLower: string,
        queryLength: number,
        maxResults: number,
        results: SearchResult[],
        pendingResults: SearchResult[]
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const stream = fs.createReadStream(fileItem.filePath, {
                encoding: 'utf8',
                highWaterMark: 64 * 1024
            });

            let buffer = '';
            let lineIndex = 0;

            stream.on('data', (chunk: string) => {
                if (results.length >= maxResults) {
                    stream.destroy();
                    resolve();
                    return;
                }
                buffer += chunk;
                let lastIndex = 0;
                let newlineIndex;

                while ((newlineIndex = buffer.indexOf('\n', lastIndex)) !== -1) {
                    const line = buffer.slice(lastIndex, newlineIndex);
                    lastIndex = newlineIndex + 1;

                    if (line.length > 10000) {
                        lineIndex++;
                        continue;
                    }

                    const matchIndex = line.toLowerCase().indexOf(queryLower);
                    if (matchIndex >= 0) {
                        const trimmedLine = line.trim();
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
                                highlights: [[matchIndex, matchIndex + queryLength]],
                            };
                            results.push(result);
                            pendingResults.push(result);
                        }
                    }
                    lineIndex++;
                    if (results.length >= maxResults) {
                        stream.destroy();
                        resolve();
                        return;
                    }
                }
                if (lastIndex > 0) buffer = buffer.slice(lastIndex);
                if (buffer.length > 100 * 1024) buffer = '';
            });

            stream.on('end', () => {
                resolve();
            });
            stream.on('error', () => {
                 resolve();
            });
        });
    }

    getRecentItems(count: number): SearchResult[] {
        return [];
    }

    recordActivity(itemId: string): void {
        // No-op
    }
}
