import * as fs from 'fs';
import * as Fuzzysort from 'fuzzysort';
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';
import { Config } from './config';
import { MinHeap } from './min-heap';
import { RipgrepService } from './ripgrep-service';
import { RouteMatcher } from './route-matcher';
import { ISearchProvider } from './search-interface';
import { SearchableItem, SearchItemType, SearchOptions, SearchResult, SearchScope } from './types';

// REMOVED: PreparedItem interface
// We now use parallel arrays to save memory (Struct of Arrays)

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

const SCOPE_BY_ITEM_TYPE: Record<SearchItemType, SearchScope> = {
    [SearchItemType.CLASS]: SearchScope.TYPES,
    [SearchItemType.INTERFACE]: SearchScope.TYPES,
    [SearchItemType.ENUM]: SearchScope.TYPES,
    [SearchItemType.FUNCTION]: SearchScope.SYMBOLS,
    [SearchItemType.METHOD]: SearchScope.SYMBOLS,
    [SearchItemType.PROPERTY]: SearchScope.PROPERTIES,
    [SearchItemType.VARIABLE]: SearchScope.PROPERTIES,
    [SearchItemType.FILE]: SearchScope.FILES,
    [SearchItemType.TEXT]: SearchScope.TEXT,
    [SearchItemType.COMMAND]: SearchScope.COMMANDS,
    [SearchItemType.ENDPOINT]: SearchScope.ENDPOINTS,
};

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine implements ISearchProvider {
    // Parallel Arrays (Struct of Arrays)
    private items: SearchableItem[] = [];
    private preparedNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedNamesLow: (string | null)[] = [];
    private preparedFullNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedPaths: (Fuzzysort.Prepared | null)[] = [];
    private preparedCapitals: (string | null)[] = [];
    private filePaths: string[] = [];

    // Deduplication cache for prepared strings
    private preparedCache: Map<string, Fuzzysort.Prepared> = new Map();
    private preparedLowCache: Map<string, string> = new Map();
    private removedSinceLastPrune: number = 0;

    // Map Scope -> Array of Indices
    private scopedIndices: Map<SearchScope, number[]> = new Map();

    private itemsMap: Map<string, SearchableItem> = new Map();
    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;
    private config?: Config;
    private logger?: { log: (msg: string) => void; error: (msg: string) => void };
    private activeFiles: Set<string> = new Set();
    private ripgrep: RipgrepService | undefined;

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
     * Set extension path for locating binaries
     */
    setExtensionPath(extensionPath: string): void {
        this.ripgrep = new RipgrepService(extensionPath);
    }

    /**
     * Set the searchable items and update hot-arrays
     */
    setItems(items: SearchableItem[]): void {
        this.items = items;
        this.itemsMap.clear();
        this.preparedCache.clear();
        this.preparedLowCache.clear();
        this.filePaths = [];
        for (const item of items) {
            this.itemsMap.set(item.id, item);
        }
        this.rebuildHotArrays();
    }

    /**
     * Add items to the search index and update hot-arrays incrementally
     */
    addItems(items: SearchableItem[]): void {
        // Pre-calculate start index for new items
        const startIndex = this.items.length;

        // Append items
        this.items.push(...items);

        for (let i = 0; i < items.length; i++) {
            this.processAddedItem(items[i], startIndex + i);
        }
    }

    private processAddedItem(item: SearchableItem, globalIndex: number): void {
        this.itemsMap.set(item.id, item);

        // Update file paths cache
        if (item.type === SearchItemType.FILE) {
            this.filePaths.push(item.filePath);
        }

        const normalizedPath = item.relativeFilePath ? item.relativeFilePath.replace(/\\/g, '/') : null;
        const shouldPrepareFullName =
            item.fullName && item.fullName !== item.name && item.fullName !== item.relativeFilePath;

        // Push to parallel arrays
        this.preparedNames.push(this.getPrepared(item.name));
        this.preparedNamesLow.push(this.getPreparedLow(item.name));
        this.preparedFullNames.push(
            shouldPrepareFullName && item.fullName ? this.getPrepared(item.fullName) : null,
        );
        this.preparedPaths.push(normalizedPath ? this.getPrepared(normalizedPath) : null);
        this.preparedCapitals.push(this.extractCapitals(item.name));

        // Update scopes
        const scope = this.getScopeForItemType(item.type);

        let indices = this.scopedIndices.get(scope);
        if (!indices) {
            indices = [];
            this.scopedIndices.set(scope, indices);
        }
        indices.push(globalIndex);
    }

    /**
     * Remove items from a specific file and update hot-arrays incrementally
     * Optimized: Uses in-place compaction to avoid allocating new arrays.
     */
    removeItemsByFile(filePath: string): void {
        const count = this.items.length;
        const write = this.compactItems(filePath, count);
        this.truncateArrays(write, count, filePath);
    }

    private compactItems(filePath: string, count: number): number {
        let write = 0;
        for (let read = 0; read < count; read++) {
            const item = this.items[read];
            if (item.filePath !== filePath) {
                if (read !== write) {
                    this.moveItem(read, write);
                }
                write++;
            } else {
                this.itemsMap.delete(item.id);
            }
        }
        return write;
    }

    private moveItem(read: number, write: number): void {
        this.items[write] = this.items[read];
        this.preparedNames[write] = this.preparedNames[read];
        this.preparedNamesLow[write] = this.preparedNamesLow[read];
        this.preparedFullNames[write] = this.preparedFullNames[read];
        this.preparedPaths[write] = this.preparedPaths[read];
        this.preparedCapitals[write] = this.preparedCapitals[read];
    }

    private truncateArrays(write: number, count: number, filePath: string): void {
        // Truncate arrays if items were removed
        if (write < count) {
            this.items.length = write;
            this.preparedNames.length = write;
            this.preparedNamesLow.length = write;
            this.preparedFullNames.length = write;
            this.preparedPaths.length = write;
            this.preparedCapitals.length = write;

            // Update file paths cache (filter out the removed file)
            this.filePaths = this.filePaths.filter((p) => p !== filePath);

            // Rebuild scope indices
            this.rebuildScopeIndices();

            // Periodic cache pruning
            this.removedSinceLastPrune++;
            // Optimization: Increased threshold to 50000 to avoid frequent O(N) scans
            if (this.removedSinceLastPrune > 50000 && this.preparedCache.size > 10000) {
                this.pruneCache();
                this.removedSinceLastPrune = 0;
            }
        }
    }

    /**
     * Remove unused entries from the prepared cache to prevent memory leaks
     */
    private pruneCache(): void {
        this.prunePreparedCache();
        this.pruneLowCache();
    }

    private prunePreparedCache(): void {
        const usedPrepared = new Set<Fuzzysort.Prepared>();

        // Collect used prepared objects
        for (const p of this.preparedNames) if (p) usedPrepared.add(p);
        for (const p of this.preparedFullNames) if (p) usedPrepared.add(p);
        for (const p of this.preparedPaths) if (p) usedPrepared.add(p);

        // Remove unused from cache
        for (const [key, prepared] of this.preparedCache) {
            if (!usedPrepared.has(prepared)) {
                this.preparedCache.delete(key);
            }
        }
    }

    private pruneLowCache(): void {
        // Prune low string cache if it grows too large (prevent leaks)
        if (this.preparedLowCache.size > 20000) {
            const usedNames = new Set<string>();
            for (const item of this.items) {
                usedNames.add(item.name);
            }

            for (const [key] of this.preparedLowCache) {
                if (!usedNames.has(key)) {
                    this.preparedLowCache.delete(key);
                }
            }
        }
    }

    /**
     * Rebuild pre-filtered arrays for each search scope and pre-prepare fuzzysort
     */
    private rebuildHotArrays(): void {
        // Clear parallel arrays
        this.preparedNames = [];
        this.preparedNamesLow = [];
        this.preparedFullNames = [];
        this.preparedPaths = [];
        this.preparedCapitals = [];

        // Prepare items
        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            const item = this.items[i];

            if (item.type === SearchItemType.FILE) {
                this.filePaths.push(item.filePath);
            }

            const normalizedPath = item.relativeFilePath ? item.relativeFilePath.replace(/\\/g, '/') : null;
            const shouldPrepareFullName =
                item.fullName && item.fullName !== item.name && item.fullName !== item.relativeFilePath;

            this.preparedNames.push(this.getPrepared(item.name));
            this.preparedNamesLow.push(this.getPreparedLow(item.name));
            this.preparedFullNames.push(
                shouldPrepareFullName && item.fullName ? this.getPrepared(item.fullName) : null,
            );
            this.preparedPaths.push(normalizedPath ? this.getPrepared(normalizedPath) : null);
            this.preparedCapitals.push(this.extractCapitals(item.name));
        }

        this.rebuildScopeIndices();
    }

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

    private rebuildScopeIndices(): void {
        this.scopedIndices.clear();

        // Initialize arrays (optional, but good for cleanliness)
        for (const scope of Object.values(SearchScope)) {
            // EVERYTHING scope is handled implicitly by the main arrays,
            // so we don't store indices for it to save memory.
            if (scope !== SearchScope.EVERYTHING) {
                this.scopedIndices.set(scope, []);
            }
        }

        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            const scope = this.getScopeForItemType(this.items[i].type);
            this.scopedIndices.get(scope)?.push(i);
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
        this.activeFiles = new Set(files.map((f) => path.normalize(f)));
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.items = [];
        this.preparedNames = [];
        this.preparedNamesLow = [];
        this.preparedFullNames = [];
        this.preparedPaths = [];
        this.preparedCapitals = [];
        this.itemsMap.clear();
        this.scopedIndices.clear();
        this.preparedCache.clear();
        this.preparedLowCache.clear();
    }

    /**
     * Get total number of items
     */
    getItemCount(): number {
        return this.items.length;
    }

    /**
     * Get detailed index statistics
     */
    getStats(): { totalItems: number; fileCount: number; typeCount: number; symbolCount: number } {
        let fileCount = 0;
        let typeCount = 0;
        let symbolCount = 0;

        for (const item of this.items) {
            if (item.type === SearchItemType.FILE) {
                fileCount++;
            } else if (
                item.type === SearchItemType.CLASS ||
                item.type === SearchItemType.INTERFACE ||
                item.type === SearchItemType.ENUM
            ) {
                typeCount++;
            } else if (
                item.type === SearchItemType.METHOD ||
                item.type === SearchItemType.FUNCTION ||
                item.type === SearchItemType.PROPERTY
            ) {
                symbolCount++;
            }
        }

        return {
            totalItems: this.items.length,
            fileCount,
            typeCount,
            symbolCount,
        };
    }

    /**
     * Perform search
     */
    async search(
        options: SearchOptions,
        onResultOrToken?: ((result: SearchResult) => void) | CancellationToken,
    ): Promise<SearchResult[]> {
        const { query, scope, maxResults = 50, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) {
            return [];
        }

        const onResult = typeof onResultOrToken === 'function' ? onResultOrToken : undefined;
        // Note: CancellationToken is not currently used in this implementation but is accepted for interface compatibility

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        // Special handling for text search
        if (scope === SearchScope.TEXT && this.config?.isTextSearchEnabled()) {
            return this.performTextSearch(effectiveQuery, maxResults, onResult);
        }

        const normalizedQuery = effectiveQuery.replace(/\\/g, '/');

        // 1. Filter and search
        // Pass the indices we want to search. undefined means "all"
        const indices = scope === SearchScope.EVERYTHING ? undefined : this.scopedIndices.get(scope);

        // Unified search (Fuzzy + CamelHumps in single pass)
        let results = this.performUnifiedSearch(indices, normalizedQuery, enableCamelHumps, maxResults, scope);

        // 3. Sort by score (Actually results are already sorted descending by performUnifiedSearch)
        // But in case we want to be safe or if we changed logic later.
        // performUnifiedSearch returns sorted array.

        // 4. Boost by activity and re-sort final time
        // Optimization: Boosting is now done INSIDE performUnifiedSearch.

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

        return results;
    }

    /**
     * Perform grep-like text search on indexed files using streams or ripgrep
     */
    private async performTextSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void,
    ): Promise<SearchResult[]> {
        // Try Ripgrep first
        if (this.ripgrep && this.ripgrep.isAvailable()) {
           const results = await this.performRipgrepSearch(query, maxResults, onResult);
           if (results) return results;
        }

        return this.performStreamSearch(query, maxResults, onResult);
    }

    private async performRipgrepSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): Promise<SearchResult[] | null> {
        this.logger?.log(`--- Starting LSP Text Search (Ripgrep): "${query}" ---`);
        const startTime = Date.now();
        try {
            // Pass cached file paths to ripgrep (No mapping/filtering needed)
            const matches = await this.ripgrep!.search(query, this.filePaths, maxResults);

            const results: SearchResult[] = [];
            for (const match of matches) {
                // Find original item
                const fileItem = this.itemsMap.get(`file:${match.path}`);
                if (!fileItem) continue;

                const result: SearchResult = {
                    item: {
                        id: `text:${match.path}:${match.line}:${match.column}`,
                        name: match.text,
                        type: SearchItemType.TEXT,
                        filePath: match.path,
                        relativeFilePath: fileItem.relativeFilePath,
                        line: match.line,
                        column: match.column,
                        containerName: fileItem.name,
                        detail: fileItem.relativeFilePath,
                    },
                    score: 1.0,
                    scope: SearchScope.TEXT,
                    highlights: match.submatches.map((sm) => [sm.start, sm.end]),
                };
                results.push(result);
                if (onResult) onResult(result);
            }

            const durationMs = Date.now() - startTime;
            this.logger?.log(
                `Ripgrep search completed in ${(durationMs / 1000).toFixed(3)}s. Found ${results.length} results.`,
            );
            return results;
        } catch (error) {
            this.logger?.error(`Ripgrep failed: ${error}. Falling back to Node.js stream.`);
            return null;
        }
    }

    private async performStreamSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void
    ): Promise<SearchResult[]> {
        this.logger?.log(`--- Starting LSP Text Search (Streaming): "${query}" ---`);
        const startTime = Date.now();
        const results: SearchResult[] = [];
        const queryLower = query.toLowerCase();

        // Fallback: Node.js Stream Search
        // We still need fileItems for the fallback implementation
        const fileItems = this.items.filter((item) => item.type === SearchItemType.FILE);

        // Zed Optimization: Prioritize active/open files
        const prioritizedFiles = fileItems.sort((a, b) => {
            const aActive = this.activeFiles.has(path.normalize(a.filePath)) ? 1 : 0;
            const bActive = this.activeFiles.has(path.normalize(b.filePath)) ? 1 : 0;
            return bActive - aActive;
        });

        // Limit concurrency
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
                        if (stats.size > 5 * 1024 * 1024) return; // Skip files larger than 5MB still, but can be relaxed now

                        processedFiles++;

                        await this.scanFileStream(
                            fileItem,
                            queryLower,
                            query.length,
                            maxResults,
                            results,
                            pendingResults,
                        );
                    } catch {
                        // Ignore read/stat errors
                    }
                }),
            );

            if (pendingResults.length >= 5) {
                flushBatch();
            }

            if (processedFiles % 100 === 0 || results.length > 0) {
                this.logger?.log(
                    `Searched ${processedFiles}/${fileItems.length} files... found ${results.length} matches`,
                );
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
        pendingResults: SearchResult[],
    ): Promise<void> {
        return new Promise<void>((resolve) => {
            const stream = fs.createReadStream(fileItem.filePath, {
                encoding: 'utf8',
                highWaterMark: 64 * 1024, // 64KB chunks
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
                
                // Process full lines
                const { newBuffer, newLineIndex, hitLimit } = this.processBufferLines(
                    buffer,
                    queryLower,
                    queryLength,
                    maxResults,
                    results,
                    pendingResults,
                    fileItem,
                    lineIndex
                );

                buffer = newBuffer;
                lineIndex = newLineIndex;

                if (hitLimit) {
                     stream.destroy();
                     resolve();
                     return;
                }

                // Safety: Discard buffer if it grows too large without finding a newline (minified file)
                if (buffer.length > 100 * 1024) {
                    buffer = '';
                }
            });

            stream.on('end', () => {
                // Process last line if any
                if (buffer.length > 0) {
                    const matchIndex = buffer.toLowerCase().indexOf(queryLower);
                    if (matchIndex >= 0) {
                        const trimmedLine = buffer.trim();
                        if (trimmedLine.length > 0) {
                             const result = this.createSearchResult(
                                fileItem,
                                trimmedLine,
                                lineIndex,
                                matchIndex,
                                queryLength
                            );
                            results.push(result);
                            pendingResults.push(result);
                        }
                    }
                }
                resolve();
            });

            stream.on('error', () => {
                // Ignore error, just resolve
                resolve();
            });
        });
    }

    private processBufferLines(
        buffer: string,
        queryLower: string,
        queryLength: number,
        maxResults: number,
        results: SearchResult[],
        pendingResults: SearchResult[],
        fileItem: SearchableItem,
        startLineIndex: number
    ): { newBuffer: string; newLineIndex: number; hitLimit: boolean } {
        let lastIndex = 0;
        let newlineIndex;
        let lineIndex = startLineIndex;

        while ((newlineIndex = buffer.indexOf('\n', lastIndex)) !== -1) {
            // Optimized: Avoid slicing buffer repeatedly. Only slice the line we need.
            const line = buffer.slice(lastIndex, newlineIndex);
            lastIndex = newlineIndex + 1;

            // Skip extremely long lines (minified code)
            if (line.length > 10000) {
                lineIndex++;
                continue;
            }

            // Simple case insensitive check
            const matchIndex = line.toLowerCase().indexOf(queryLower);

            if (matchIndex >= 0) {
                const trimmedLine = line.trim();
                if (trimmedLine.length > 0) {
                    const result = this.createSearchResult(
                        fileItem,
                        trimmedLine,
                        lineIndex,
                        matchIndex,
                        queryLength
                    );

                    results.push(result);
                    pendingResults.push(result);
                }
            }

            lineIndex++;

            if (results.length >= maxResults) {
                return { newBuffer: '', newLineIndex: lineIndex, hitLimit: true };
            }
        }

        // Keep remainder
        const newBuffer = lastIndex > 0 ? buffer.slice(lastIndex) : buffer;
        return { newBuffer, newLineIndex: lineIndex, hitLimit: false };
    }

    private createSearchResult(
        fileItem: SearchableItem,
        trimmedLine: string,
        lineIndex: number,
        matchIndex: number,
        queryLength: number
    ): SearchResult {
        return {
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
    }

    private performUnifiedSearch(
        indices: number[] | undefined,
        query: string,
        enableCamelHumps: boolean,
        maxResults: number,
        scope: SearchScope,
    ): SearchResult[] {
        const heap = new MinHeap<SearchResult>(maxResults, (a, b) => a.score - b.score);
        const MIN_SCORE = 0.01;
        const queryUpper = enableCamelHumps ? query.toUpperCase() : '';
        const isPotentialUrl =
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) && RouteMatcher.isPotentialUrl(query);
        const queryLen = query.length;

        // Cache parallel arrays and config to avoid 'this' access in loop
        const items = this.items;
        const preparedNames = this.preparedNames;
        const preparedFullNames = this.preparedFullNames;
        const preparedPaths = this.preparedPaths;
        const preparedCapitals = this.preparedCapitals;
        const getActivityScore = this.getActivityScore;
        const activityWeight = this.activityWeight;

        // Single loop to avoid code duplication
        const count = indices ? indices.length : items.length;
        
        for (let k = 0; k < count; k++) {
            const i = indices ? indices[k] : k;

            // --- INLINED LOOP BODY START ---
            const item = items[i];
            let score = -1;
            // Optimization: Use lookup table instead of method call
            let resultScope = SCOPE_BY_ITEM_TYPE[item.type] || SearchScope.EVERYTHING;

            // 1. Fuzzy Scoring
            let bestFuzzyScore = -Infinity;

            // Name (Weight 1.0)
            const preparedName = preparedNames[i];
            if (preparedName && queryLen <= preparedName.target.length) {
                const result = Fuzzysort.single(query, preparedName);
                if (result && result.score > MIN_SCORE) {
                    bestFuzzyScore = result.score;
                }
            }

            // Optimization: Name has weight 1.0. Next best is FullName with 0.9.
            if (bestFuzzyScore < 0.9) {
                // Full Name (Weight 0.9)
                const preparedFullName = preparedFullNames[i];
                if (preparedFullName && queryLen <= preparedFullName.target.length) {
                    const result = Fuzzysort.single(query, preparedFullName);
                    if (result && result.score * 0.9 > bestFuzzyScore) {
                        bestFuzzyScore = result.score * 0.9;
                    }
                }

                if (bestFuzzyScore < 0.8) {
                    // Path (Weight 0.8)
                    const preparedPath = preparedPaths[i];
                    if (preparedPath && queryLen <= preparedPath.target.length) {
                        const result = Fuzzysort.single(query, preparedPath);
                        if (result && result.score * 0.8 > bestFuzzyScore) {
                            bestFuzzyScore = result.score * 0.8;
                        }
                    }
                }
            }

            if (bestFuzzyScore > MIN_SCORE) {
                score = bestFuzzyScore * (ITEM_TYPE_BOOSTS[item.type] || 1.0);
            } else if (enableCamelHumps) {
                // CamelHumps fallback
                const capitals = preparedCapitals[i];
                if (capitals) {
                    const matchIndex = capitals.indexOf(queryUpper);
                    if (matchIndex !== -1) {
                        const lengthRatio = queryLen / capitals.length;
                        const positionBoost = matchIndex === 0 ? 1.5 : 1.0;
                        score = (lengthRatio * positionBoost * 0.8) * (ITEM_TYPE_BOOSTS[item.type] || 1.0);
                    }
                }
            }

            // 2. URL/Endpoint Match
            if (isPotentialUrl && item.type === SearchItemType.ENDPOINT) {
                if (RouteMatcher.isMatch(item.name, query)) {
                    const urlScore = 1.5;
                    if (urlScore > score) {
                        score = urlScore;
                        resultScope = SearchScope.ENDPOINTS;
                    }
                }
            }

            // 3. Activity Boosting
            if (score > MIN_SCORE && getActivityScore) {
                const activityScore = getActivityScore(item.id);
                if (activityScore > 0 && score > 0.05) {
                    score = score * (1 - activityWeight) + activityScore * activityWeight;
                }
            }

            if (score > MIN_SCORE) {
                // Optimization: Skip allocation if heap is full and score is too low
                if (heap.isFull()) {
                    const minItem = heap.peek();
                    if (minItem && score <= minItem.score) {
                        continue;
                    }
                }

                heap.push({
                    item,
                    score,
                    scope: resultScope,
                });
            }
            // --- INLINED LOOP BODY END ---
        }

        return heap.getSorted();
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

    private normalizeFuzzysortScore(score: number): number {
        return Math.max(0, Math.min(1, score));
    }

    private applyItemTypeBoost(score: number, type: SearchItemType): number {
        return score * (ITEM_TYPE_BOOSTS[type] || 1.0);
    }

    private getScopeForItemType(type: SearchItemType): SearchScope {
        return SCOPE_BY_ITEM_TYPE[type] || SearchScope.EVERYTHING;
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

    burstSearch(
        options: SearchOptions,
        onResultOrToken?: ((result: SearchResult) => void) | CancellationToken,
    ): SearchResult[] {
        const { query, scope, maxResults = 10 } = options;
        if (!query || query.trim().length === 0) {
            return [];
        }

        const onResult = typeof onResultOrToken === 'function' ? onResultOrToken : undefined;

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        const normalizedQuery = effectiveQuery.replace(/\\/g, '/');

        // Pass indices for burst match
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
                item: {
                    ...r.item,
                    line: targetLine,
                },
            }));
        }

        return results.sort((a, b) => b.score - a.score);
    }

    private findBurstMatches(
        indices: number[] | undefined,
        queryLower: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void,
    ): SearchResult[] {
        const results: SearchResult[] = [];

        const processItem = (i: number) => {
            // Check max results break
            if (results.length >= maxResults) return;

            const item = this.items[i];
            const nameLower = this.preparedNamesLow[i] || item.name.toLowerCase();

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
        };

        if (indices) {
            for (let k = 0; k < indices.length; k++) {
                if (results.length >= maxResults) break;
                processItem(indices[k]);
            }
        } else {
            const count = this.items.length;
            for (let i = 0; i < count; i++) {
                if (results.length >= maxResults) break;
                processItem(i);
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

    // Kept for burstSearch usage
    private addUrlMatches(
        results: SearchResult[],
        indices: number[] | undefined,
        queryLower: string,
        maxResults?: number,
    ): void {
        const existingIds = new Set(results.map((r) => r.item.id));

        const checkItem = (i: number) => {
            if (maxResults && results.length >= maxResults) return;

            const item = this.items[i];
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
        };

        if (indices) {
            for (const i of indices) {
                if (maxResults && results.length >= maxResults) break;
                checkItem(i);
            }
        } else {
            for (let i = 0; i < this.items.length; i++) {
                if (maxResults && results.length >= maxResults) break;
                checkItem(i);
            }
        }
    }

    // Kept for burstSearch usage
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

    getRecentItems(): SearchResult[] {
        return [];
    }

    recordActivity(): void {
        // No-op
    }
}
