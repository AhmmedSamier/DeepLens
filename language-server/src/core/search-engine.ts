import * as fs from 'fs';
import * as Fuzzysort from 'fuzzysort';
import * as path from 'path';
import { CancellationToken } from 'vscode-languageserver';
import { Config } from './config';
import { GitProvider } from './git-provider';
import { MinHeap } from './min-heap';
import { RipgrepService } from './ripgrep-service';
import { RouteMatcher } from './route-matcher';
import {
    ISearchProvider,
    SearchableItem,
    SearchContext,
    SearchItemType,
    SearchOptions,
    SearchResult,
    SearchScope,
} from './types';

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

const TYPE_TO_ID: Record<SearchItemType, number> = {
    [SearchItemType.FILE]: 1,
    [SearchItemType.CLASS]: 2,
    [SearchItemType.INTERFACE]: 3,
    [SearchItemType.ENUM]: 4,
    [SearchItemType.FUNCTION]: 5,
    [SearchItemType.METHOD]: 6,
    [SearchItemType.PROPERTY]: 7,
    [SearchItemType.VARIABLE]: 8,
    [SearchItemType.TEXT]: 9,
    [SearchItemType.COMMAND]: 10,
    [SearchItemType.ENDPOINT]: 11,
};

// 0 is reserved/undefined, boosts start from 1
const ID_TO_BOOST = [
    1.0, // 0 (fallback)
    ITEM_TYPE_BOOSTS[SearchItemType.FILE],
    ITEM_TYPE_BOOSTS[SearchItemType.CLASS],
    ITEM_TYPE_BOOSTS[SearchItemType.INTERFACE],
    ITEM_TYPE_BOOSTS[SearchItemType.ENUM],
    ITEM_TYPE_BOOSTS[SearchItemType.FUNCTION],
    ITEM_TYPE_BOOSTS[SearchItemType.METHOD],
    ITEM_TYPE_BOOSTS[SearchItemType.PROPERTY],
    ITEM_TYPE_BOOSTS[SearchItemType.VARIABLE],
    ITEM_TYPE_BOOSTS[SearchItemType.TEXT],
    ITEM_TYPE_BOOSTS[SearchItemType.COMMAND],
    ITEM_TYPE_BOOSTS[SearchItemType.ENDPOINT],
];

const ID_TO_SCOPE = [
    SearchScope.EVERYTHING, // 0
    SearchScope.FILES,
    SearchScope.TYPES,
    SearchScope.TYPES,
    SearchScope.TYPES,
    SearchScope.SYMBOLS,
    SearchScope.SYMBOLS,
    SearchScope.PROPERTIES,
    SearchScope.PROPERTIES,
    SearchScope.TEXT,
    SearchScope.COMMANDS,
    SearchScope.ENDPOINTS,
];

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine implements ISearchProvider {
    id = 'engine';
    priority = 0;
    private providers: ISearchProvider[] = [];

    // Parallel Arrays (Struct of Arrays)
    private items: SearchableItem[] = [];
    private itemTypeIds: Uint8Array = new Uint8Array(0);
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

    public itemsMap: Map<string, SearchableItem> = new Map();
    private activityWeight: number = 0.3;
    private getActivityScore?: (itemId: string) => number;
    private config?: Config;
    private logger?: { log: (msg: string) => void; error: (msg: string) => void };
    private activeFiles: Set<string> = new Set();
    private ripgrep: RipgrepService | undefined;
    private gitProvider: GitProvider | undefined;

    /**
     * Set logger
     */
    setLogger(logger: { log: (msg: string) => void; error: (msg: string) => void }): void {
        this.logger = logger;
    }

    public registerProvider(provider: ISearchProvider) {
        this.providers.push(provider);
        this.providers.sort((a, b) => b.priority - a.priority);
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
     * Set workspace roots for git provider
     */
    setWorkspaceRoots(roots: string[]): void {
        this.gitProvider = new GitProvider(roots);
    }

    /**
     * Set the searchable items and update hot-arrays
     */
    setItems(items: SearchableItem[]): void {
        this.items = items;
        this.itemTypeIds = new Uint8Array(items.length);
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

        // Resize itemTypeIds
        if (this.itemTypeIds.length < startIndex + items.length) {
            const newTypeIds = new Uint8Array(startIndex + items.length);
            newTypeIds.set(this.itemTypeIds);
            this.itemTypeIds = newTypeIds;
        }

        // Append items
        this.items.push(...items);

        for (let i = 0; i < items.length; i++) {
            this.processAddedItem(items[i], startIndex + i);
        }
    }

    private processAddedItem(item: SearchableItem, globalIndex: number): void {
        this.itemsMap.set(item.id, item);
        this.itemTypeIds[globalIndex] = TYPE_TO_ID[item.type];

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
        this.preparedFullNames.push(shouldPrepareFullName && item.fullName ? this.getPrepared(item.fullName) : null);
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
        this.itemTypeIds[write] = this.itemTypeIds[read];
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
            this.itemTypeIds = this.itemTypeIds.slice(0, write);
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
            this.itemTypeIds[i] = TYPE_TO_ID[item.type];

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
        this.itemTypeIds = new Uint8Array(0);
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

    private createSearchContext(options: SearchOptions): SearchContext {
        const query = options.query || '';
        return {
            query,
            normalizedQuery: query.replace(/\\/g, '/'),
            queryUpper: query.toUpperCase(),
            scope: options.scope || SearchScope.EVERYTHING,
            maxResults: options.maxResults || 50,
            enableCamelHumps: options.enableCamelHumps !== false,
            isPotentialUrl: RouteMatcher.isPotentialUrl(query),
        };
    }

    /**
     * Get approximate memory/cache size in bytes
     */
    getCacheSize(): number {
        let size = 0;

        // items array (rough estimate: 200 bytes per SearchableItem)
        size += this.items.length * 200;

        // Parallel arrays
        size += this.itemTypeIds.byteLength;
        size += this.preparedNames.length * 8;
        size += this.preparedNamesLow.length * 8;
        size += this.preparedFullNames.length * 8;
        size += this.preparedPaths.length * 8;
        size += this.preparedCapitals.length * 8;

        // Cache maps (rough estimate: 100 bytes per entry)
        size += this.preparedCache.size * 100;
        size += this.preparedLowCache.size * 50;

        return size;
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
            return this.handleEmptyQuerySearch(options, maxResults);
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

        const context = this.createSearchContext({
            ...options,
            query: effectiveQuery,
            maxResults,
        });

        // Use providers if any are registered, otherwise fallback to internal logic
        if (this.providers.length > 0) {
            return this.executeProviderSearch(context, maxResults, targetLine, onResult);
        }

        return this.executeInternalSearch(effectiveQuery, scope, enableCamelHumps, maxResults, targetLine);
    }

    private async handleEmptyQuerySearch(options: SearchOptions, maxResults: number): Promise<SearchResult[]> {
        // New: Handle Phase 0 (Recent/Instant) via providers
        const context = this.createSearchContext(options);
        const results: SearchResult[] = [];
        for (const provider of this.providers) {
            const providerResults = await provider.search(context);
            results.push(...providerResults);
            if (results.length >= maxResults) break;
        }
        return results;
    }

    private async executeProviderSearch(
        context: SearchContext,
        maxResults: number,
        targetLine: number | undefined,
        onResult?: (result: SearchResult) => void,
    ): Promise<SearchResult[]> {
        let allResults: SearchResult[] = [];
        for (const provider of this.providers) {
            const providerResults = await provider.search(context);
            allResults.push(...providerResults);
            if (onResult) {
                providerResults.forEach((r) => onResult(r));
            }
        }

        // Post-process: sort and limit
        allResults.sort((a, b) => b.score - a.score);
        if (allResults.length > maxResults) {
            allResults = allResults.slice(0, maxResults);
        }

        if (targetLine !== undefined) {
            allResults = this.applyTargetLine(allResults, targetLine);
        }
        return allResults;
    }

    private async executeInternalSearch(
        effectiveQuery: string,
        scope: SearchScope,
        enableCamelHumps: boolean,
        maxResults: number,
        targetLine: number | undefined,
    ): Promise<SearchResult[]> {
        const normalizedQuery = effectiveQuery.replace(/\\/g, '/');

        // 1. Filter and search
        let indices: number[] | undefined;

        if (scope === SearchScope.OPEN) {
            indices = this.getIndicesForOpenFiles();
        } else if (scope === SearchScope.MODIFIED) {
            indices = await this.getIndicesForModifiedFiles();
        } else {
            // Pass the indices we want to search. undefined means "all"
            indices = scope === SearchScope.EVERYTHING ? undefined : this.scopedIndices.get(scope);
        }

        // Unified search (Fuzzy + CamelHumps in single pass)
        let results = this.performUnifiedSearch(indices, normalizedQuery, enableCamelHumps, maxResults, scope);

        // Apply target line if found
        if (targetLine !== undefined) {
            results = this.applyTargetLine(results, targetLine);
        }

        return results;
    }

    private getIndicesForOpenFiles(): number[] {
        const indices: number[] = [];
        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            if (this.activeFiles.has(this.items[i].filePath)) {
                indices.push(i);
            }
        }
        return indices;
    }

    private async getIndicesForModifiedFiles(): Promise<number[]> {
        if (!this.gitProvider) return [];
        const modifiedFiles = await this.gitProvider.getModifiedFiles();
        const indices: number[] = [];
        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            // Normalize path for comparison just in case
            if (modifiedFiles.has(path.normalize(this.items[i].filePath))) {
                indices.push(i);
            }
        }
        return indices;
    }

    private applyTargetLine(results: SearchResult[], targetLine: number): SearchResult[] {
        return results.map((r) => ({
            ...r,
            item: {
                ...r.item,
                line: targetLine,
            },
        }));
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
        onResult?: (result: SearchResult) => void,
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
        onResult?: (result: SearchResult) => void,
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
                    lineIndex,
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
                            const indentation = buffer.search(/\S|$/);
                            const result = this.createSearchResult(
                                fileItem,
                                trimmedLine,
                                lineIndex,
                                matchIndex,
                                queryLength,
                                indentation,
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
        startLineIndex: number,
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
                    const indentation = line.search(/\S|$/);
                    const result = this.createSearchResult(
                        fileItem,
                        trimmedLine,
                        lineIndex,
                        matchIndex,
                        queryLength,
                        indentation,
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
        queryLength: number,
        indentation: number,
    ): SearchResult {
        // Calculate relative match index for highlighting (since name is trimmed)
        const relativeMatchIndex = Math.max(0, matchIndex - indentation);

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
            highlights: [[relativeMatchIndex, relativeMatchIndex + queryLength]],
        };
    }

    public performSymbolSearch(context: SearchContext): SearchResult[] {
        const indices =
            context.scope === SearchScope.EVERYTHING
                ? this.scopedIndices
                      .get(SearchScope.SYMBOLS)
                      ?.concat(
                          this.scopedIndices.get(SearchScope.TYPES) || [],
                          this.scopedIndices.get(SearchScope.PROPERTIES) || [],
                          this.scopedIndices.get(SearchScope.ENDPOINTS) || [],
                      )
                : this.scopedIndices.get(context.scope);

        return this.performUnifiedSearch(
            indices,
            context.normalizedQuery,
            context.enableCamelHumps,
            context.maxResults,
            context.scope,
        );
    }

    public performFileSearch(context: SearchContext): SearchResult[] {
        const indices = this.scopedIndices.get(SearchScope.FILES);
        return this.performUnifiedSearch(
            indices,
            context.normalizedQuery,
            context.enableCamelHumps,
            context.maxResults,
            context.scope,
        );
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

        const processIndex = (i: number) => {
            this.processUnifiedSearchItem(i, query, queryUpper, enableCamelHumps, isPotentialUrl, MIN_SCORE, heap);
        };

        if (indices) {
            for (let k = 0; k < indices.length; k++) {
                processIndex(indices[k]);
            }
        } else {
            const count = this.items.length;
            for (let i = 0; i < count; i++) {
                processIndex(i);
            }
        }

        return heap.getSorted();
    }

    private processUnifiedSearchItem(
        i: number,
        query: string,
        queryUpper: string,
        enableCamelHumps: boolean,
        isPotentialUrl: boolean,
        minScore: number,
        heap: MinHeap<SearchResult>,
    ): void {
        // Optimized: Delay accessing this.items[i] (object) until we know it's a match.
        // This avoids cache misses for filtered-out items.

        const typeId = this.itemTypeIds[i];

        // --- INLINED calculateUnifiedScore ---
        let score = this.computeFuzzyScore(i, typeId, query, minScore);

        if (score < 0.9 && enableCamelHumps) {
            const camelScore = this.computeCamelHumpsScore(i, typeId, query.length, queryUpper);
            if (camelScore > score) {
                score = camelScore; // Use CamelHumps if better
            }
        }

        let resultScope: SearchScope | undefined;

        // 2. URL/Endpoint Match
        if (isPotentialUrl && typeId === 11 /* ENDPOINT */) {
            // Need name for URL match. Use prepared target or fallback to item.
            const name = this.preparedNames[i]?.target;
            if (name) {
                const urlScore = this.computeUrlScore(name, query);
                if (urlScore > score) {
                    score = urlScore;
                    resultScope = SearchScope.ENDPOINTS;
                }
            }
        }

        if (score <= minScore) return;

        if (resultScope === undefined) {
            resultScope = ID_TO_SCOPE[typeId];
        }

        // Now access the full item object
        const item = this.items[i];
        if (!item) return;

        // 3. Activity Boosting
        score = this.computeActivityScore(item.id, score, minScore);

        if (score > minScore) {
            this.tryPushToHeap(heap, item, score, resultScope);
        }
    }

    private computeFuzzyScore(i: number, typeId: number, query: string, minScore: number): number {
        let bestScore = -Infinity;
        const queryLen = query.length;

        // Name (1.0)
        const nameScore = this.calculateFieldScore(query, this.preparedNames[i], queryLen);
        if (nameScore > minScore) bestScore = nameScore;

        if (bestScore >= 0.9) return bestScore * (ID_TO_BOOST[typeId] || 1.0);

        // Full Name (0.9)
        const fullNameScore = this.calculateFieldScore(query, this.preparedFullNames[i], queryLen);
        if (fullNameScore * 0.9 > bestScore) bestScore = fullNameScore * 0.9;

        if (bestScore >= 0.8) return bestScore * (ID_TO_BOOST[typeId] || 1.0);

        // Path (0.8)
        const pathScore = this.calculateFieldScore(query, this.preparedPaths[i], queryLen);
        if (pathScore * 0.8 > bestScore) bestScore = pathScore * 0.8;

        if (bestScore > minScore) return bestScore * (ID_TO_BOOST[typeId] || 1.0);
        return -Infinity;
    }

    private calculateFieldScore(query: string, prepared: Fuzzysort.Prepared | null, queryLen: number): number {
        if (prepared && queryLen <= prepared.target.length) {
            const res = Fuzzysort.single(query, prepared);
            return res ? res.score : -Infinity;
        }
        return -Infinity;
    }

    private computeCamelHumpsScore(i: number, typeId: number, queryLen: number, queryUpper: string): number {
        const capitals = this.preparedCapitals[i];
        if (capitals) {
            const matchIndex = capitals.indexOf(queryUpper);
            if (matchIndex !== -1) {
                const lengthRatio = queryLen / capitals.length;
                const positionBoost = matchIndex === 0 ? 1.5 : 1.0;
                return lengthRatio * positionBoost * 0.8 * (ID_TO_BOOST[typeId] || 1.0);
            }
        }
        return -Infinity;
    }

    private computeUrlScore(name: string, query: string): number {
        if (RouteMatcher.isMatch(name, query)) {
            return 1.5;
        }
        return -Infinity;
    }

    private computeActivityScore(itemId: string, currentScore: number, minScore: number): number {
        if (currentScore > minScore && this.getActivityScore) {
            const activityScore = this.getActivityScore(itemId);
            if (activityScore > 0 && currentScore > 0.05) {
                return currentScore * (1 - this.activityWeight) + activityScore * this.activityWeight;
            }
        }
        return currentScore;
    }

    private tryPushToHeap(heap: MinHeap<SearchResult>, item: SearchableItem, score: number, scope: SearchScope): void {
        // Optimization: Skip allocation if heap is full and score is too low
        if (heap.isFull()) {
            const minItem = heap.peek();
            if (minItem && score <= minItem.score) {
                return;
            }
        }
        heap.push({
            item,
            score,
            scope,
        });
    }

    private calculateUnifiedScore(
        i: number,
        item: SearchableItem,
        query: string,
        queryUpper: string,
        enableCamelHumps: boolean,
        isPotentialUrl: boolean,
        minScore: number,
    ): { score: number; resultScope: SearchScope } {
        // Kept for backward compatibility if needed, but not used in hot path
        let score = -1;
        let resultScope = this.getScopeForItemType(item.type);

        // 1. Fuzzy or CamelHumps
        score = this.calculateBasicScore(i, item, query, queryUpper, enableCamelHumps, minScore);

        // 2. URL/Endpoint Match
        if (isPotentialUrl && item.type === SearchItemType.ENDPOINT) {
            const { newScore, newScope } = this.checkUrlMatch(item, query, score, resultScope);
            score = newScore;
            resultScope = newScope;
        }

        // 3. Activity Boosting
        if (score > minScore) {
            score = this.applyActivityBoost(item, score);
        }

        return { score, resultScope };
    }

    private calculateBasicScore(
        i: number,
        item: SearchableItem,
        query: string,
        queryUpper: string,
        enableCamelHumps: boolean,
        minScore: number,
    ): number {
        const fuzzyScore = this.calculateItemScore(
            query,
            this.preparedNames[i],
            this.preparedFullNames[i],
            this.preparedPaths[i],
            minScore,
        );

        if (fuzzyScore > minScore) {
            return this.applyItemTypeBoost(fuzzyScore, this.itemTypeIds[i]);
        }

        if (enableCamelHumps) {
            const capitals = this.preparedCapitals[i];
            if (capitals) {
                const camelScore = this.camelHumpsMatch(capitals, queryUpper);
                if (camelScore > 0) {
                    return this.applyItemTypeBoost(camelScore, this.itemTypeIds[i]);
                }
            }
        }
        return -1;
    }

    private checkUrlMatch(
        item: SearchableItem,
        query: string,
        currentScore: number,
        currentScope: SearchScope,
    ): { newScore: number; newScope: SearchScope } {
        if (RouteMatcher.isMatch(item.name, query)) {
            const urlScore = 1.5;
            if (urlScore > currentScore) {
                return { newScore: urlScore, newScope: SearchScope.ENDPOINTS };
            }
        }
        return { newScore: currentScore, newScope: currentScope };
    }

    private applyActivityBoost(item: SearchableItem, currentScore: number): number {
        if (this.getActivityScore) {
            const activityScore = this.getActivityScore(item.id);
            if (activityScore > 0 && currentScore > 0.05) {
                return currentScore * (1 - this.activityWeight) + activityScore * this.activityWeight;
            }
        }
        return currentScore;
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

        // Name (Weight 1.0)
        const nameScore = this.scoreField(query, preparedName, queryLen, minScore);
        if (nameScore > bestScore) bestScore = nameScore;

        // Optimization: Name has weight 1.0. Next best is FullName with 0.9.
        if (bestScore >= 0.9) return bestScore;

        // Full Name (Weight 0.9)
        const fullNameScore = this.scoreField(query, preparedFullName, queryLen, minScore);
        if (fullNameScore * 0.9 > bestScore) bestScore = fullNameScore * 0.9;

        // Optimization: Next best is Path with 0.8.
        if (bestScore >= 0.8) return bestScore;

        // Path (Weight 0.8)
        const pathScore = this.scoreField(query, preparedPath, queryLen, minScore);
        if (pathScore * 0.8 > bestScore) bestScore = pathScore * 0.8;

        return bestScore;
    }

    private scoreField(query: string, prepared: Fuzzysort.Prepared | null, queryLen: number, minScore: number): number {
        if (prepared && queryLen <= prepared.target.length) {
            const result = Fuzzysort.single(query, prepared);
            if (result && result.score > minScore) {
                return result.score;
            }
        }
        return -Infinity;
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

    private applyItemTypeBoost(score: number, typeId: number): number {
        return score * (ID_TO_BOOST[typeId] || 1.0);
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
        let indices: number[] | undefined;
        if (scope === SearchScope.OPEN) {
            indices = this.getIndicesForOpenFiles();
        } else if (scope === SearchScope.MODIFIED) {
            return [];
        } else {
            indices = scope === SearchScope.EVERYTHING ? undefined : this.scopedIndices.get(scope);
        }

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

            // Optimization: Access parallel array first before full object to improve cache locality.
            // Only access this.items[i] if strictly necessary (match found or cache missing).
            let nameLower = this.preparedNamesLow[i];
            let item: SearchableItem | undefined;

            if (nameLower === null || nameLower === undefined) {
                item = this.items[i];
                if (!item) return;
                nameLower = item.name.toLowerCase();
            }

            if (nameLower === queryLower || nameLower.startsWith(queryLower)) {
                if (!item) {
                    item = this.items[i];
                    if (!item) return;
                }

                const result: SearchResult = {
                    item,
                    score: this.applyItemTypeBoost(1.0, this.itemTypeIds[i]),
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
