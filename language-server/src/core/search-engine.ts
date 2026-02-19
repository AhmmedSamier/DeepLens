import * as Fuzzysort from 'fuzzysort';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CancellationToken } from 'vscode-languageserver';
import { Config } from './config';
import { GitProvider } from './git-provider';
import { MinHeap } from './min-heap';
import { RipgrepService } from './ripgrep-service';
import { PreparedPath, RouteMatcher, RoutePattern } from './route-matcher';
import {
    ISearchProvider,
    SearchableItem,
    SearchContext,
    SearchItemType,
    SearchOptions,
    SearchResult,
    SearchScope,
} from './types';

// Extend Fuzzysort.Prepared to include internal property
interface ExtendedPrepared extends Fuzzysort.Prepared {
    _targetLower: string;
}

interface TextScanContext {
    query: string;
    queryRegex: RegExp;
    queryRegexGlobal: RegExp;
    queryLength: number;
    maxResults: number;
    results: SearchResult[];
    pendingResults: SearchResult[];
    fileItem: SearchableItem;
    token?: CancellationToken;
}

// REMOVED: PreparedItem interface
// We now use parallel arrays to save memory (Struct of Arrays)

const ITEM_TYPE_BOOSTS: Record<SearchItemType, number> = {
    [SearchItemType.CLASS]: 1.5,
    [SearchItemType.INTERFACE]: 1.35,
    [SearchItemType.ENUM]: 1.3,
    [SearchItemType.FUNCTION]: 1.25,
    [SearchItemType.METHOD]: 1.25,
    [SearchItemType.PROPERTY]: 1.1,
    [SearchItemType.VARIABLE]: 1,
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
    1, // 0 (fallback)
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

// Precompute ASCII bitflags table for O(1) lookup
// Maps char code (0-127) to a bitmask.
const CHAR_TO_BITFLAG = new Uint32Array(128);

// Default to 'other ascii' (bit 30) for all entries initially
for (let i = 0; i < 128; i++) {
    CHAR_TO_BITFLAG[i] = 1 << 30;
}

// 0-9 -> bit 26
for (let i = 48; i <= 57; i++) {
    CHAR_TO_BITFLAG[i] = 1 << 26;
}

// A-Z -> 0-25 (Normalized to a-z, so 'A' maps to bit 0)
for (let i = 65; i <= 90; i++) {
    CHAR_TO_BITFLAG[i] = 1 << (i - 65);
}

// a-z -> 0-25 (Maps to bit 0-25)
for (let i = 97; i <= 122; i++) {
    CHAR_TO_BITFLAG[i] = 1 << (i - 97);
}

// Space (32) -> 0 (ignored)
CHAR_TO_BITFLAG[32] = 0;

/**
 * Core search engine that performs fuzzy matching and CamelHumps search
 */
export class SearchEngine implements ISearchProvider {
    id = 'engine';
    priority = 0;
    private readonly providers: ISearchProvider[] = [];

    // Parallel Arrays (Struct of Arrays)
    private items: SearchableItem[] = [];
    private itemTypeIds: Uint8Array = new Uint8Array(0);
    private itemBitflags: Uint32Array = new Uint32Array(0);
    private itemNameBitflags: Uint32Array = new Uint32Array(0);
    private preparedNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedFullNames: (Fuzzysort.Prepared | null)[] = [];
    private preparedPaths: (Fuzzysort.Prepared | null)[] = [];
    private preparedCapitals: (string | null)[] = [];
    private preparedPatterns: (RoutePattern | null)[] = [];
    private filePaths: string[] = [];

    // 1-item cache for normalizePath (filePath -> normalizedPath)
    private lastFilePath: string | null = null;
    private lastNormalizedFilePath: string | null = null;

    // 1-item cache for relative path normalization in populateParallelArrays
    private lastRelPath: string | null = null;
    private lastRelPathNormalized: string | null = null;

    // Deduplication cache for prepared strings
    private readonly preparedCache: Map<string, { prepared: Fuzzysort.Prepared; refCount: number }> = new Map();

    // Map Scope -> Array of Indices
    private readonly scopedIndices: Map<SearchScope, number[]> = new Map();

    // Map Normalized File Path -> Array of Item Indices (Reverse Index for O(1) lookup)
    private readonly fileToItemIndices: Map<string, number[]> = new Map();

    public itemsMap: Map<string, SearchableItem> = new Map();
    private readonly fileItemByNormalizedPath: Map<string, SearchableItem> = new Map();
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
        this.providers.sort((a, b) => (b.priority || 0) - (a.priority || 0));
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
    async setItems(items: SearchableItem[]): Promise<void> {
        this.items = items;
        this.itemTypeIds = new Uint8Array(items.length);
        this.itemBitflags = new Uint32Array(items.length);
        this.itemNameBitflags = new Uint32Array(items.length);
        this.itemsMap.clear();
        this.fileItemByNormalizedPath.clear();
        this.preparedCache.clear();
        this.filePaths = [];
        for (const item of items) {
            this.itemsMap.set(item.id, item);
        }
        await this.rebuildHotArrays();
    }

    /**
     * Add items to the search index and update hot-arrays incrementally
     */
    async addItems(items: SearchableItem[]): Promise<void> {
        // Pre-calculate start index for new items
        const startIndex = this.items.length;
        const requiredSize = startIndex + items.length;

        // Resize itemTypeIds and itemBitflags with exponential growth
        if (this.itemTypeIds.length < requiredSize) {
            // Growth Strategy: 1.5x or requiredSize to prevent frequent allocations
            const newCapacity = Math.max(requiredSize, Math.ceil(this.itemTypeIds.length * 1.5));

            const newTypeIds = new Uint8Array(newCapacity);
            newTypeIds.set(this.itemTypeIds);
            this.itemTypeIds = newTypeIds;

            const newBitflags = new Uint32Array(newCapacity);
            newBitflags.set(this.itemBitflags);
            this.itemBitflags = newBitflags;

            const newNameBitflags = new Uint32Array(newCapacity);
            newNameBitflags.set(this.itemNameBitflags);
            this.itemNameBitflags = newNameBitflags;
        }

        // Append items
        this.items.push(...items);

        const CHUNK_SIZE = 500;
        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, items.length);
            for (let j = i; j < end; j++) {
                this.processAddedItem(items[j], startIndex + j);
            }

            // Yield to main thread for responsiveness
            if (end < items.length) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
    }

    private processAddedItem(item: SearchableItem, globalIndex: number): void {
        this.itemsMap.set(item.id, item);

        // Use shared item preparation logic
        this.prepareItemAtIndex(item, globalIndex);

        // Update scope indices
        this.updateScopeIndices(item, globalIndex);

        // Update file indices
        this.updateFileIndices(item, globalIndex);
    }

    /**
     * Update scope indices for a newly added item
     */
    private updateScopeIndices(item: SearchableItem, globalIndex: number): void {
        const scope = this.getScopeForItemType(item.type);
        let indices = this.scopedIndices.get(scope);
        if (!indices) {
            indices = [];
            this.scopedIndices.set(scope, indices);
        }
        indices.push(globalIndex);
    }

    /**
     * Update file-to-item indices for a newly added item
     */
    private updateFileIndices(item: SearchableItem, globalIndex: number): void {
        const normalizedFilePath = this.normalizePath(item.filePath);
        let fileIndices = this.fileToItemIndices.get(normalizedFilePath);
        if (!fileIndices) {
            fileIndices = [];
            this.fileToItemIndices.set(normalizedFilePath, fileIndices);
        }
        fileIndices.push(globalIndex);
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
            if (item.filePath === filePath) {
                this.releasePrepared(this.preparedNames[read]);
                this.releasePrepared(this.preparedFullNames[read]);
                this.releasePrepared(this.preparedPaths[read]);

                this.itemsMap.delete(item.id);
                if (item.type === SearchItemType.FILE) {
                    this.fileItemByNormalizedPath.delete(this.normalizePath(item.filePath));
                }
            } else {
                if (read !== write) {
                    this.moveItem(read, write);
                }
                write++;
            }
        }
        return write;
    }

    private moveItem(read: number, write: number): void {
        this.items[write] = this.items[read];
        this.itemTypeIds[write] = this.itemTypeIds[read];
        this.itemBitflags[write] = this.itemBitflags[read];
        this.itemNameBitflags[write] = this.itemNameBitflags[read];
        this.preparedNames[write] = this.preparedNames[read];
        this.preparedFullNames[write] = this.preparedFullNames[read];
        this.preparedPaths[write] = this.preparedPaths[read];
        this.preparedCapitals[write] = this.preparedCapitals[read];
        this.preparedPatterns[write] = this.preparedPatterns[read];
    }

    private truncateArrays(write: number, count: number, filePath: string): void {
        // Truncate arrays if items were removed
        if (write < count) {
            this.items.length = write;
            this.itemTypeIds = this.itemTypeIds.slice(0, write);
            this.itemBitflags = this.itemBitflags.slice(0, write);
            this.itemNameBitflags = this.itemNameBitflags.slice(0, write);
            this.preparedNames.length = write;
            this.preparedFullNames.length = write;
            this.preparedPaths.length = write;
            this.preparedCapitals.length = write;
            this.preparedPatterns.length = write;

            // Update file paths cache (filter out the removed file)
            this.filePaths = this.filePaths.filter((p) => p !== filePath);

            // Rebuild scope indices
            this.rebuildScopeIndices();
            this.rebuildFileIndices();
        }
    }

    /**
     * Rebuild pre-filtered arrays for each search scope and pre-prepare fuzzysort
     */
    private async rebuildHotArrays(): Promise<void> {
        this.clearParallelArrays();

        const count = this.items.length;
        const CHUNK_SIZE = 1000;

        for (let i = 0; i < count; i += CHUNK_SIZE) {
            await this.processItemChunk(i, Math.min(i + CHUNK_SIZE, count));

            // Yield to main thread for responsiveness
            if (i + CHUNK_SIZE < count) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        this.rebuildScopeIndices();
        this.rebuildFileIndices();
    }

    /**
     * Clear all parallel arrays
     */
    private clearParallelArrays(): void {
        this.preparedNames = [];
        this.preparedFullNames = [];
        this.preparedPaths = [];
        this.preparedCapitals = [];
        this.preparedPatterns = [];
    }

    /**
     * Process a chunk of items for rebuilding hot arrays
     */
    private async processItemChunk(start: number, end: number): Promise<void> {
        for (let j = start; j < end; j++) {
            const item = this.items[j];
            this.prepareItemAtIndex(item, j);
        }
    }

    /**
     * Prepare a single item and populate parallel arrays at the given index
     */
    private prepareItemAtIndex(item: SearchableItem, index: number): void {
        this.itemTypeIds[index] = TYPE_TO_ID[item.type];

        const { nameFlags, aggregateFlags } = this.computeItemBitflags(item);
        this.itemNameBitflags[index] = nameFlags;
        this.itemBitflags[index] = aggregateFlags;

        this.updateFileCache(item);
        this.populateParallelArrays(item);
    }

    /**
     * Compute bitflags for an item (name flags and aggregate flags)
     */
    private computeItemBitflags(item: SearchableItem): { nameFlags: number; aggregateFlags: number } {
        const nameFlags = this.calculateBitflags(item.name);
        let aggregateFlags = nameFlags;

        if (this.shouldProcessFullName(item) && item.fullName) {
            aggregateFlags |= this.calculateBitflags(item.fullName);
        }

        if (item.relativeFilePath) {
            aggregateFlags |= this.calculateBitflags(item.relativeFilePath);
        }

        return { nameFlags, aggregateFlags };
    }

    /**
     * Check if fullName should be processed separately
     */
    private shouldProcessFullName(item: SearchableItem): boolean {
        return !!item.fullName && item.fullName !== item.name && item.fullName !== item.relativeFilePath;
    }

    /**
     * Update file-related caches for FILE type items
     */
    private updateFileCache(item: SearchableItem): void {
        if (item.type === SearchItemType.FILE) {
            this.filePaths.push(item.filePath);
            this.fileItemByNormalizedPath.set(this.normalizePath(item.filePath), item);
        }
    }

    /**
     * Populate parallel arrays with prepared data for an item
     */
    private populateParallelArrays(item: SearchableItem): void {
        let normalizedPath: string | null = null;

        if (item.relativeFilePath) {
            if (item.relativeFilePath === this.lastRelPath) {
                normalizedPath = this.lastRelPathNormalized;
            } else {
                normalizedPath = item.relativeFilePath.replace(/\\/g, '/');
                this.lastRelPath = item.relativeFilePath;
                this.lastRelPathNormalized = normalizedPath;
            }
        }

        const shouldPrepareFullName = this.shouldProcessFullName(item);

        this.preparedNames.push(this.getPrepared(item.name));
        this.preparedFullNames.push(shouldPrepareFullName && item.fullName ? this.getPrepared(item.fullName) : null);
        this.preparedPaths.push(normalizedPath ? this.getPrepared(normalizedPath) : null);
        this.preparedCapitals.push(this.extractCapitals(item.name));
        this.preparedPatterns.push(item.type === SearchItemType.ENDPOINT ? RouteMatcher.precompute(item.name) : null);
    }

    private rebuildFileIndices(): void {
        this.fileToItemIndices.clear();
        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            const filePath = this.normalizePath(this.items[i].filePath);
            let indices = this.fileToItemIndices.get(filePath);
            if (!indices) {
                indices = [];
                this.fileToItemIndices.set(filePath, indices);
            }
            indices.push(i);
        }
    }

    private getPrepared(text: string): Fuzzysort.Prepared {
        const entry = this.preparedCache.get(text);
        if (entry) {
            entry.refCount++;
            return entry.prepared;
        }

        const prepared = Fuzzysort.prepare(text);
        this.preparedCache.set(text, { prepared, refCount: 1 });
        return prepared;
    }

    private releasePrepared(prepared: Fuzzysort.Prepared | null): void {
        if (!prepared) return;
        const key = prepared.target;
        const entry = this.preparedCache.get(key);
        if (entry) {
            entry.refCount--;
            if (entry.refCount <= 0) {
                this.preparedCache.delete(key);
            }
        }
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

    private readonly isWindows = process.platform === 'win32';

    /**
     * Set the list of currently active or open files to prioritize them
     */
    setActiveFiles(files: string[]): void {
        this.activeFiles = new Set(
            files.map((f) => {
                const normalized = path.normalize(f);
                return this.isWindows ? normalized.toLowerCase() : normalized;
            }),
        );
    }

    /**
     * Clear all items
     */
    clear(): void {
        this.items = [];
        this.itemTypeIds = new Uint8Array(0);
        this.itemBitflags = new Uint32Array(0);
        this.itemNameBitflags = new Uint32Array(0);
        this.preparedNames = [];
        this.preparedFullNames = [];
        this.preparedPaths = [];
        this.preparedCapitals = [];
        this.preparedPatterns = [];
        this.itemsMap.clear();
        this.fileItemByNormalizedPath.clear();
        this.scopedIndices.clear();
        this.fileToItemIndices.clear();
        this.preparedCache.clear();
        this.lastFilePath = null;
        this.lastNormalizedFilePath = null;
        this.lastRelPath = null;
        this.lastRelPathNormalized = null;
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
            normalizedQuery: query.replaceAll('\\', '/'),
            queryUpper: query.toUpperCase(),
            scope: options.scope || SearchScope.EVERYTHING,
            maxResults: options.maxResults || 20,
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
        size += this.itemBitflags.byteLength;
        size += this.itemNameBitflags.byteLength;
        size += this.preparedNames.length * 8;
        size += this.preparedFullNames.length * 8;
        size += this.preparedPaths.length * 8;
        size += this.preparedCapitals.length * 8;

        // Cache maps (rough estimate: 100 bytes per entry)
        size += this.preparedCache.size * 100;

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
        token?: CancellationToken,
    ): Promise<SearchResult[]> {
        const { query, scope, maxResults = 20, enableCamelHumps = true } = options;

        if (!query || query.trim().length === 0) {
            return this.handleEmptyQuerySearch(options, maxResults);
        }

        const onResult = typeof onResultOrToken === 'function' ? onResultOrToken : undefined;
        // If the second arg is the token, use it. Otherwise use the third arg.
        const cancellationToken = onResult ? token : (onResultOrToken as CancellationToken);

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        // Special handling for text search
        if (scope === SearchScope.TEXT && this.config?.isTextSearchEnabled()) {
            return this.performTextSearch(effectiveQuery, maxResults, onResult, cancellationToken);
        }

        const context = this.createSearchContext({
            ...options,
            query: effectiveQuery,
            maxResults,
        });

        // Use providers if any are registered, otherwise fallback to internal logic
        // EXCEPT for scopes that require filtering indexed items directly (OPEN, MODIFIED)
        if (this.providers.length > 0 && scope !== SearchScope.OPEN && scope !== SearchScope.MODIFIED) {
            return this.executeProviderSearch(context, maxResults, targetLine, onResult, cancellationToken);
        }

        return this.executeInternalSearch(
            effectiveQuery,
            scope,
            enableCamelHumps,
            maxResults,
            targetLine,
            cancellationToken,
        );
    }

    private async handleEmptyQuerySearch(options: SearchOptions, maxResults: number): Promise<SearchResult[]> {
        // New: Handle Phase 0 (Recent/Instant) via providers
        const context = this.createSearchContext(options);
        let results: SearchResult[] = [];
        for (const provider of this.providers) {
            const providerResults = await provider.search(context);
            results.push(...providerResults);
            if (results.length >= maxResults) break;
        }

        // Apply scope filtering to empty query results (e.g., for /o or /m history)
        if (options.scope === SearchScope.OPEN) {
            results = results.filter((r) => this.isActive(r.item.filePath));
        } else if (options.scope === SearchScope.MODIFIED && this.gitProvider) {
            const modifiedFiles = await this.gitProvider.getModifiedFiles();
            results = results.filter((r) => modifiedFiles.has(this.normalizePath(r.item.filePath)));
        }

        return results;
    }

    private async executeProviderSearch(
        context: SearchContext,
        maxResults: number,
        targetLine: number | undefined,
        onResult?: (result: SearchResult) => void,
        token?: CancellationToken,
    ): Promise<SearchResult[]> {
        let allResults: SearchResult[] = [];
        for (const provider of this.providers) {
            if (token?.isCancellationRequested) break;
            try {
                const providerResults = await provider.search(context);
                allResults.push(...providerResults);
                if (onResult) {
                    providerResults.forEach((r) => {
                        if (!token?.isCancellationRequested) onResult(r);
                    });
                }
            } catch (error) {
                this.logger?.error(`Provider ${provider.id} failed: ${error}`);
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
        token?: CancellationToken,
    ): Promise<SearchResult[]> {
        const normalizedQuery = effectiveQuery.replaceAll('\\', '/');

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
        let results = this.performUnifiedSearch(indices, normalizedQuery, enableCamelHumps, maxResults, scope, token);

        // Apply target line if found
        if (targetLine !== undefined) {
            results = this.applyTargetLine(results, targetLine);
        }

        return results;
    }

    private normalizePath(filePath: string): string {
        if (filePath === this.lastFilePath) {
            return this.lastNormalizedFilePath!;
        }

        const normalized = path.normalize(filePath);
        const result = this.isWindows ? normalized.toLowerCase() : normalized;
        this.lastFilePath = filePath;
        this.lastNormalizedFilePath = result;
        return result;
    }

    private isActive(filePath: string): boolean {
        return this.activeFiles.has(this.normalizePath(filePath));
    }

    private getIndicesForOpenFiles(): number[] {
        const indices: number[] = [];
        const count = this.items.length;
        for (let i = 0; i < count; i++) {
            if (this.isActive(this.items[i].filePath)) {
                indices.push(i);
            }
        }
        return indices;
    }

    private async getIndicesForModifiedFiles(): Promise<number[]> {
        if (!this.gitProvider) return [];
        const modifiedFiles = await this.gitProvider.getModifiedFiles();
        const indices: number[] = [];

        for (const filePath of modifiedFiles) {
            const itemIndices = this.fileToItemIndices.get(filePath);
            if (itemIndices) {
                for (const index of itemIndices) {
                    indices.push(index);
                }
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
        token?: CancellationToken,
    ): Promise<SearchResult[]> {
        // Try Ripgrep first
        if (this.ripgrep?.isAvailable()) {
            const results = await this.performRipgrepSearch(query, maxResults, onResult, token);
            // Fallback to stream search ONLY if ripgrep failed (null) or found nothing ([])
            // We want to be extra robust in tests and edge cases
            if (results && results.length > 0) return results;
        }

        return this.performStreamSearch(query, maxResults, onResult, token);
    }

    private async performRipgrepSearch(
        query: string,
        maxResults: number,
        onResult?: (result: SearchResult) => void,
        token?: CancellationToken,
    ): Promise<SearchResult[] | null> {
        this.logger?.log(`--- Starting LSP Text Search (Ripgrep): "${query}" ---`);
        const startTime = Date.now();
        try {
            if (token?.isCancellationRequested) return [];
            // Pass cached file paths to ripgrep (No mapping/filtering needed)
            const matches = await this.ripgrep.search(query, this.filePaths, maxResults, token);

            const results: SearchResult[] = [];
            for (const match of matches) {
                // Find original item (with path normalization fallback)
                let fileItem = this.itemsMap.get(`file:${match.path}`);
                if (!fileItem) {
                    fileItem = this.fileItemByNormalizedPath.get(this.normalizePath(match.path));
                }

                if (!fileItem) {
                    this.logger?.error(`Ripgrep result path not found in index: ${match.path}`);
                    continue;
                }

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
                    score: 1,
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
        token?: CancellationToken,
    ): Promise<SearchResult[]> {
        this.logger?.log(`--- Starting LSP Text Search (Streaming): "${query}" ---`);
        const startTime = Date.now();
        const results: SearchResult[] = [];

        // Pre-compile regexes to avoid re-compilation in hot loops
        const queryRegex = new RegExp(escapeRegExp(query), 'i');
        const queryRegexGlobal = new RegExp(escapeRegExp(query), 'gi');

        // Fallback: Node.js Stream Search
        // We still need fileItems for the fallback implementation
        const fileItems = this.items.filter((item) => item.type === SearchItemType.FILE);

        // Zed Optimization: Prioritize active/open files
        fileItems.sort((a, b) => {
            const aActive = this.isActive(a.filePath) ? 1 : 0;
            const bActive = this.isActive(b.filePath) ? 1 : 0;
            return bActive - aActive;
        });
        const prioritizedFiles = fileItems;

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
                firstResultTime ??= Date.now() - startTime;
                if (onResult) {
                    pendingResults.forEach((r) => onResult(r));
                }
                pendingResults = [];
            }
        };

        for (const chunk of chunks) {
            if (results.length >= maxResults || token?.isCancellationRequested) break;

            await Promise.all(
                chunk.map(async (fileItem) => {
                    if (results.length >= maxResults || token?.isCancellationRequested) return;

                    try {
                        // Optimization: Use cached size if available to avoid fs.stat calls
                        let fileSize = fileItem.size;
                        if (fileSize === undefined) {
                            const stats = await fs.promises.stat(fileItem.filePath);
                            fileSize = stats.size;
                            fileItem.size = fileSize;
                        }

                        if (fileSize > 5 * 1024 * 1024) return; // Skip files larger than 5MB still, but can be relaxed now

                        processedFiles++;

                        const scanContext: TextScanContext = {
                            query,
                            queryRegex,
                            queryRegexGlobal,
                            queryLength: query.length,
                            maxResults,
                            results,
                            pendingResults,
                            fileItem,
                            token,
                        };

                        await this.scanFileStream(scanContext, fileSize);
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
        const firstResultLog = firstResultTime === null ? '' : ` (First result in ${firstResultTime}ms)`;

        this.logger?.log(`Text search completed in ${durationSec}s${firstResultLog}. Found ${results.length} results.`);
        return results;
    }

    private async scanFileStream(context: TextScanContext, fileSize?: number): Promise<void> {
        const { fileItem, queryRegex, queryLength, maxResults, results, pendingResults, token } = context;

        // Optimization: For small files, readFile is significantly faster than createReadStream
        if (fileSize !== undefined && fileSize < 50 * 1024) {
            try {
                const content = await fs.promises.readFile(fileItem.filePath, 'utf8');
                if (results.length >= maxResults) return;

                const { newBuffer, newLineIndex } = this.processBufferLines(content, 0, context, 0);

                if (newBuffer.length > 0) {
                    const match = queryRegex.exec(newBuffer);
                    if (match) {
                        const matchIndex = match.index;
                        const trimmedLine = newBuffer.trim();
                        if (trimmedLine.length > 0) {
                            const indentation = newBuffer.search(/\S|$/);
                            const result = this.createSearchResult(
                                fileItem,
                                trimmedLine,
                                newLineIndex,
                                matchIndex,
                                queryLength,
                                indentation,
                            );
                            results.push(result);
                            pendingResults.push(result);
                        }
                    }
                }
                return;
            } catch {
                // Fallback to stream
            }
        }

        return new Promise<void>((resolve) => {
            const stream = fs.createReadStream(fileItem.filePath, {
                encoding: 'utf8',
                highWaterMark: 64 * 1024, // 64KB chunks
            });

            let chunkBuffer: string[] = [];
            let bufferedLength = 0;
            let lineIndex = 0;

            stream.on('data', (chunk: string) => {
                if (results.length >= maxResults || token?.isCancellationRequested) {
                    stream.destroy();
                    resolve();
                    return;
                }

                const newlineIndex = chunk.indexOf('\n');

                if (newlineIndex === -1) {
                    chunkBuffer.push(chunk);
                    bufferedLength += chunk.length;

                    if (bufferedLength > 100 * 1024) {
                        chunkBuffer = [];
                        bufferedLength = 0;
                    }
                    return;
                }

                const firstPart = chunk.substring(0, newlineIndex);
                const completeLine = chunkBuffer.length > 0 ? chunkBuffer.join('') + firstPart : firstPart;

                chunkBuffer = [];
                bufferedLength = 0;

                // Process first line (legacy way or update to new way?)
                // Since this is a reconstructed line, we treat it as a single line buffer
                const match = queryRegex.exec(completeLine);
                if (match) {
                    const hitLimit = this.processSingleLine(completeLine, lineIndex, match.index, context);
                    if (hitLimit) {
                        stream.destroy();
                        resolve();
                        return;
                    }
                }

                lineIndex++;

                const { newBuffer, newLineIndex, hitLimit } = this.processBufferLines(
                    chunk,
                    newlineIndex + 1,
                    context,
                    lineIndex,
                );

                if (newBuffer.length > 0) {
                    chunkBuffer.push(newBuffer);
                    bufferedLength += newBuffer.length;
                }

                lineIndex = newLineIndex;

                if (hitLimit) {
                    stream.destroy();
                    resolve();
                }
            });

            stream.on('end', () => {
                if (chunkBuffer.length > 0) {
                    const buffer = chunkBuffer.join('');
                    const match = queryRegex.exec(buffer);
                    if (match) {
                        const trimmedLine = buffer.trim();
                        if (trimmedLine.length > 0) {
                            const indentation = buffer.search(/\S|$/);
                            const result = this.createSearchResult(
                                fileItem,
                                trimmedLine,
                                lineIndex,
                                match.index,
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
                resolve();
            });
        });
    }

    private processBufferLines(
        buffer: string,
        bufferOffset: number,
        context: TextScanContext,
        startLineIndex: number,
    ): { newBuffer: string; newLineIndex: number; hitLimit: boolean } {
        const matches = this.getAllMatches(buffer, bufferOffset, context.queryRegexGlobal);

        // Fast path: No matches in this chunk
        if (matches.length === 0) {
            return this.advanceLinesWithoutMatches(buffer, bufferOffset, startLineIndex);
        }

        return this.processLinesWithMatches(buffer, bufferOffset, matches, startLineIndex, context);
    }

    private getAllMatches(buffer: string, bufferOffset: number, regex: RegExp): number[] {
        // Optimization: Scan buffer for matches using RegExp first
        // avoiding repeated toLowerCase() allocations for every line
        const matches: number[] = [];
        let m;

        // If bufferOffset > 0, we are scanning a slice effectively, but regex runs on string from start?
        // buffer argument is the FULL string chunk passed to this function.
        // But we should only look at matches AFTER bufferOffset.
        // regex.lastIndex works if we use 'g'.
        regex.lastIndex = bufferOffset;
        while ((m = regex.exec(buffer)) !== null) {
            matches.push(m.index);
        }
        return matches;
    }

    private advanceLinesWithoutMatches(
        buffer: string,
        bufferOffset: number,
        startLineIndex: number,
    ): { newBuffer: string; newLineIndex: number; hitLimit: boolean } {
        let lastIndex = bufferOffset;
        let newlineIndex;
        let lineIndex = startLineIndex;
        while ((newlineIndex = buffer.indexOf('\n', lastIndex)) !== -1) {
            lastIndex = newlineIndex + 1;
            lineIndex++;
        }
        const newBuffer = lastIndex > 0 ? buffer.slice(lastIndex) : buffer;
        return { newBuffer, newLineIndex: lineIndex, hitLimit: false };
    }

    private processLinesWithMatches(
        buffer: string,
        bufferOffset: number,
        matches: number[],
        startLineIndex: number,
        context: TextScanContext,
    ): { newBuffer: string; newLineIndex: number; hitLimit: boolean } {
        let currentMatchIdx = 0;
        let lastIndex = bufferOffset;
        let newlineIndex;
        let lineIndex = startLineIndex;

        while ((newlineIndex = buffer.indexOf('\n', lastIndex)) !== -1) {
            // Check if we have matches in [lastIndex, newlineIndex)
            // Skip matches that are before lastIndex (shouldn't happen if we consume correctly)
            while (currentMatchIdx < matches.length && matches[currentMatchIdx] < lastIndex) {
                currentMatchIdx++;
            }

            if (currentMatchIdx < matches.length && matches[currentMatchIdx] < newlineIndex) {
                // Found a match in this line!
                const matchIndex = matches[currentMatchIdx];
                const line = buffer.slice(lastIndex, newlineIndex);

                // Only process once per line
                const hitLimit = this.processSingleLine(
                    line,
                    lineIndex,
                    matchIndex - lastIndex, // Relative match index
                    context,
                );

                if (hitLimit) {
                    return { newBuffer: '', newLineIndex: lineIndex + 1, hitLimit: true };
                }

                // Skip all other matches in this line
                while (currentMatchIdx < matches.length && matches[currentMatchIdx] < newlineIndex) {
                    currentMatchIdx++;
                }
            }

            lastIndex = newlineIndex + 1;
            lineIndex++;
        }

        // Keep remainder
        const newBuffer = lastIndex > 0 ? buffer.slice(lastIndex) : buffer;
        return { newBuffer, newLineIndex: lineIndex, hitLimit: false };
    }

    private processSingleLine(
        line: string,
        lineIndex: number,
        matchIndexInLine: number,
        context: TextScanContext,
    ): boolean {
        // Skip extremely long lines (minified code)
        if (line.length > 10000) {
            return false;
        }

        const trimmedLine = line.trim();
        if (trimmedLine.length > 0) {
            const indentation = line.search(/\S|$/);
            const result = this.createSearchResult(
                context.fileItem,
                trimmedLine,
                lineIndex,
                matchIndexInLine,
                context.queryLength,
                indentation,
            );

            context.results.push(result);
            context.pendingResults.push(result);
        }

        return context.results.length >= context.maxResults;
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
            score: 1,
            scope: SearchScope.TEXT,
            highlights: [[relativeMatchIndex, relativeMatchIndex + queryLength]],
        };
    }

    public async performSymbolSearch(context: SearchContext): Promise<SearchResult[]> {
        let indices: number[] | undefined;

        if (context.scope === SearchScope.OPEN) {
            indices = this.getIndicesForOpenFiles();
            // Filter out files, keep only symbols
            indices = indices.filter((i) => this.items[i].type !== SearchItemType.FILE);
        } else if (context.scope === SearchScope.MODIFIED) {
            indices = await this.getIndicesForModifiedFiles();

            // Filter out files, keep only symbols
            indices = indices.filter((i) => this.items[i].type !== SearchItemType.FILE);
        } else {
            indices =
                context.scope === SearchScope.EVERYTHING
                    ? this.scopedIndices
                          .get(SearchScope.SYMBOLS)
                          ?.concat(
                              this.scopedIndices.get(SearchScope.TYPES) || [],
                              this.scopedIndices.get(SearchScope.PROPERTIES) || [],
                              this.scopedIndices.get(SearchScope.ENDPOINTS) || [],
                              this.scopedIndices.get(SearchScope.COMMANDS) || [],
                          )
                    : this.scopedIndices.get(context.scope);
        }

        return this.performUnifiedSearch(
            indices,
            context.normalizedQuery,
            context.enableCamelHumps,
            context.maxResults,
            context.scope,
        );
    }

    public async performFileSearch(context: SearchContext): Promise<SearchResult[]> {
        let indices: number[] | undefined;

        if (context.scope === SearchScope.OPEN) {
            indices = this.getIndicesForOpenFiles();
        } else if (context.scope === SearchScope.MODIFIED) {
            indices = await this.getIndicesForModifiedFiles();
        } else {
            // FILES or EVERYTHING -> Search all files
            indices = this.scopedIndices.get(SearchScope.FILES);
        }

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
        token?: CancellationToken,
    ): SearchResult[] {
        const heap = new MinHeap<SearchResult>(maxResults, (a, b) => a.score - b.score);
        const searchContext = this.prepareSearchContext(query, enableCamelHumps, scope);

        if (indices) {
            this.searchWithIndices(indices, searchContext, heap, token);
        } else {
            this.searchAllItems(searchContext, heap, token);
        }

        return heap.getSorted();
    }

    private prepareSearchContext(query: string, enableCamelHumps: boolean, scope: SearchScope) {
        const queryLen = query.length;
        const queryUpper = enableCamelHumps ? query.toUpperCase() : '';
        const isPotentialUrl =
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) && RouteMatcher.isPotentialUrl(query);
        const preparedQuery = isPotentialUrl ? RouteMatcher.prepare(query) : null;
        const queryForUrlMatch = isPotentialUrl ? RouteMatcher.prepare(query) : query;
        const queryBitflags = this.calculateBitflags(query);

        return {
            query,
            queryLen,
            queryUpper,
            isPotentialUrl,
            preparedQuery,
            queryForUrlMatch,
            queryBitflags,
            enableCamelHumps,
            MIN_SCORE: 0.01,
            // Cache parallel arrays locally to avoid `this` lookups in the hot loop
            items: this.items,
            itemTypeIds: this.itemTypeIds,
            itemBitflags: this.itemBitflags,
            itemNameBitflags: this.itemNameBitflags,
            preparedNames: this.preparedNames,
            preparedFullNames: this.preparedFullNames,
            preparedPaths: this.preparedPaths,
            preparedCapitals: this.preparedCapitals,
            preparedPatterns: this.preparedPatterns,
            getActivityScore: this.getActivityScore,
            activityWeight: this.activityWeight,
            invActivityWeight: 1 - this.activityWeight,
        };
    }

    private searchWithIndices(
        indices: number[],
        context: ReturnType<typeof this.prepareSearchContext>,
        heap: MinHeap<SearchResult>,
        token?: CancellationToken,
    ): void {
        for (let j = 0; j < indices.length; j++) {
            if (j % 500 === 0 && token?.isCancellationRequested) break;
            const i = indices[j];
            this.processItemForSearch(i, context, heap);
        }
    }

    private searchAllItems(
        context: ReturnType<typeof this.prepareSearchContext>,
        heap: MinHeap<SearchResult>,
        token?: CancellationToken,
    ): void {
        const count = context.items.length;
        for (let i = 0; i < count; i++) {
            if (i % 500 === 0 && token?.isCancellationRequested) break;
            this.processItemForSearch(i, context, heap);
        }
    }

    private processItemForSearch(
        i: number,
        context: ReturnType<typeof this.prepareSearchContext>,
        heap: MinHeap<SearchResult>,
    ): void {
        const typeId = context.itemTypeIds[i];

        // Early exit: Check if query characters are present
        if (!this.shouldProcessItem(i, typeId, context)) {
            return;
        }

        // Calculate score using multiple strategies
        let score = this.calculateSearchScore(i, typeId, context);
        let resultScope: SearchScope | undefined;

        // Check for URL/Endpoint match
        const urlResult = this.tryUrlEndpointMatch(i, typeId, context, score);
        if (urlResult) {
            score = urlResult.score;
            resultScope = urlResult.scope;
        }

        // Apply activity boost and add to heap if score is sufficient
        if (score > context.MIN_SCORE) {
            this.finalizeAndPushResult(i, score, resultScope, typeId, context, heap);
        }
    }

    private shouldProcessItem(
        i: number,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
    ): boolean {
        // Short-circuit if query characters are not present in Name, FullName, or Path
        if ((context.queryBitflags & context.itemBitflags[i]) !== context.queryBitflags) {
            // Special case: Check for potential URL/endpoint match
            const pattern = context.preparedPatterns[i];
            return (
                context.isPotentialUrl &&
                typeId === 11 /* ENDPOINT */ &&
                pattern !== null &&
                RouteMatcher.isMatchPattern(pattern, context.queryForUrlMatch)
            );
        }
        return true;
    }

    private calculateSearchScore(
        i: number,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
    ): number {
        let score = -Infinity;

        // 1. Try CamelHumps matching
        if (context.enableCamelHumps) {
            const camelScore = this.calculateCamelHumpsScore(i, typeId, context);
            if (camelScore > score) {
                score = camelScore;
            }
        }

        // 2. Try Fuzzy matching (if CamelHumps didn't yield a high score)
        if (score < 1.1) {
            const fuzzyScore = this.calculateFuzzyScore(i, typeId, context);
            if (fuzzyScore > score) {
                score = fuzzyScore;
            }
        }

        return score;
    }

    private calculateCamelHumpsScore(
        i: number,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
    ): number {
        // Optimization: Skip CamelHumps if query characters are not in the name
        if ((context.queryBitflags & context.itemNameBitflags[i]) !== context.queryBitflags) {
            return -Infinity;
        }

        const capitals = context.preparedCapitals[i];
        if (!capitals || context.queryLen > capitals.length) {
            return -Infinity;
        }

        const matchIndex = capitals.indexOf(context.queryUpper);
        if (matchIndex === -1) {
            return -Infinity;
        }

        const lengthRatio = context.queryLen / capitals.length;
        const positionBoost = matchIndex === 0 ? 1.5 : 1;
        const typeBoost = ID_TO_BOOST[typeId] || 1;
        return lengthRatio * positionBoost * 0.8 * typeBoost;
    }

    private calculateFuzzyScore(
        i: number,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
    ): number {
        // Try matching against name (weight: 1.0)
        let fuzzyScore = this.tryFuzzyMatchName(i, context);

        // Try matching against full name (weight: 0.9) if name score is not high enough
        if (fuzzyScore < 0.9) {
            const fullNameScore = this.tryFuzzyMatchFullName(i, context);
            if (fullNameScore > fuzzyScore) {
                fuzzyScore = fullNameScore;
            }
        }

        // Try matching against path (weight: 0.8) if still not high enough
        if (fuzzyScore < 0.8) {
            const pathScore = this.tryFuzzyMatchPath(i, context);
            if (pathScore > fuzzyScore) {
                fuzzyScore = pathScore;
            }
        }

        // Apply type boost to final fuzzy score
        if (fuzzyScore > context.MIN_SCORE) {
            const typeBoost = ID_TO_BOOST[typeId] || 1;
            fuzzyScore *= typeBoost;
        }

        return fuzzyScore;
    }

    private tryFuzzyMatchName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
        if ((context.queryBitflags & context.itemNameBitflags[i]) !== context.queryBitflags) {
            return -Infinity;
        }

        const pName = context.preparedNames[i];
        if (!pName || context.queryLen > pName.target.length) {
            return -Infinity;
        }

        const res = Fuzzysort.single(context.query, pName);
        return res && res.score > context.MIN_SCORE ? res.score : -Infinity;
    }

    private tryFuzzyMatchFullName(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
        const pFull = context.preparedFullNames[i];
        if (!pFull || context.queryLen > pFull.target.length) {
            return -Infinity;
        }

        const res = Fuzzysort.single(context.query, pFull);
        return res ? res.score * 0.9 : -Infinity;
    }

    private tryFuzzyMatchPath(i: number, context: ReturnType<typeof this.prepareSearchContext>): number {
        const pPath = context.preparedPaths[i];
        if (!pPath || context.queryLen > pPath.target.length) {
            return -Infinity;
        }

        const res = Fuzzysort.single(context.query, pPath);
        return res ? res.score * 0.8 : -Infinity;
    }

    private tryUrlEndpointMatch(
        i: number,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
        currentScore: number,
    ): { score: number; scope: SearchScope } | null {
        if (!context.isPotentialUrl || !context.preparedQuery || typeId !== 11 /* ENDPOINT */) {
            return null;
        }

        const pattern = context.preparedPatterns[i];
        if (!pattern) {
            return null;
        }

        const item = context.items[i];
        if (!item) {
            return null;
        }

        const matchResult = this.calculateUrlMatchScore(pattern, context);
        if (matchResult && matchResult.score > currentScore) {
            return { score: matchResult.score, scope: SearchScope.ENDPOINTS };
        }

        return null;
    }

    private calculateUrlMatchScore(
        pattern: RoutePattern,
        context: ReturnType<typeof this.prepareSearchContext>,
    ): { score: number } | null {
        let finalQueryForMatch: string | PreparedPath = context.queryForUrlMatch;
        let methodScoreBoost = 0;

        const qMethod = typeof context.queryForUrlMatch === 'string' ? undefined : context.queryForUrlMatch.method;

        if (qMethod) {
            const itemMethod = pattern.method;
            if (itemMethod) {
                if (itemMethod.startsWith(qMethod) || qMethod.startsWith(itemMethod)) {
                    methodScoreBoost = 0.5;
                } else {
                    // Method mismatch, skip specialized route matching
                    return null;
                }
            }
        }

        if (finalQueryForMatch) {
            const urlScore = RouteMatcher.scoreMatchPattern(pattern, finalQueryForMatch);
            if (urlScore > 0) {
                return { score: urlScore + methodScoreBoost };
            }
        }

        return null;
    }

    private finalizeAndPushResult(
        i: number,
        score: number,
        resultScope: SearchScope | undefined,
        typeId: number,
        context: ReturnType<typeof this.prepareSearchContext>,
        heap: MinHeap<SearchResult>,
    ): void {
        resultScope ??= ID_TO_SCOPE[typeId];

        const item = context.items[i];
        if (!item) {
            return;
        }

        // Apply activity boost
        let finalScore = score;
        if (context.getActivityScore) {
            const activityScore = context.getActivityScore(item.id);
            if (activityScore > 0 && score > 0.05) {
                finalScore = score * context.invActivityWeight + activityScore * context.activityWeight;
            }
        }

        // Only push if score is still above minimum after activity boost
        if (finalScore > context.MIN_SCORE) {
            // Skip if heap is full and this score is too low
            if (heap.isFull()) {
                const minItem = heap.peek();
                if (minItem && finalScore <= minItem.score) {
                    return;
                }
            }

            heap.push({
                item,
                score: finalScore,
                scope: resultScope,
            });
        }
    }

    private computeUrlScore(name: string, query: string): number {
        const score = RouteMatcher.scoreMatch(name, query);
        if (score > 0) {
            return score;
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
        const urlScore = RouteMatcher.scoreMatch(item.name, query);
        if (urlScore > 0) {
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

    private calculateBitflags(str: string): number {
        // Optimization: Single pass for ASCII strings using lookup table
        const len = str.length;
        let bitflags = 0;

        for (let i = 0; i < len; i++) {
            const code = str.charCodeAt(i);

            // Check for non-ASCII
            if (code > 127) {
                return this.calculateBitflagsSlow(str);
            }

            bitflags |= CHAR_TO_BITFLAG[code];
        }
        return bitflags;
    }

    private calculateBitflagsSlow(str: string): number {
        let bitflags = 0;
        const normalized = str
            .normalize('NFD')
            .replaceAll(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        for (let i = 0; i < normalized.length; i++) {
            const code = normalized.codePointAt(i);
            if (code === 32) continue; // Space ignored

            let bit = 0;
            if (code >= 97 && code <= 122) {
                bit = code - 97; // a-z
            } else if (code >= 48 && code <= 57) {
                bit = 26; // 0-9
            } else if (code <= 127) {
                bit = 30; // other ascii
            } else {
                bit = 31; // other utf8
            }
            bitflags |= 1 << bit;
        }
        return bitflags;
    }

    /**
     * Optimized capital extraction (CamelHumps)
     * Replaces regex `text.slice(1).replace(/[^A-Z]/g, '')` with a loop to avoid string allocations.
     * Speedup: ~4.5x
     */
    private extractCapitals(text: string): string {
        let res = text.charAt(0).toUpperCase();
        for (let i = 1; i < text.length; i++) {
            const code = text.codePointAt(i);
            if (code >= 65 && code <= 90) {
                // A-Z
                res += text[i];
            }
        }
        return res;
    }

    private camelHumpsMatch(capitals: string, query: string): number {
        const matchIndex = capitals.indexOf(query);
        if (matchIndex !== -1) {
            const lengthRatio = query.length / capitals.length;
            const positionBoost = matchIndex === 0 ? 1.5 : 1;
            return lengthRatio * positionBoost * 0.8;
        }

        return 0;
    }

    private normalizeFuzzysortScore(score: number): number {
        return Math.max(0, Math.min(1, score));
    }

    private applyItemTypeBoost(score: number, typeId: number): number {
        return score * (ID_TO_BOOST[typeId] || 1);
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
                    score: 1,
                    scope: this.getScopeForItemType(item.type),
                });
            }
        }
        return results;
    }

    burstSearch(
        options: SearchOptions,
        onResultOrToken?: ((result: SearchResult) => void) | CancellationToken,
        token?: CancellationToken,
    ): SearchResult[] {
        const { query, scope, maxResults = 10 } = options;
        if (!query || query.trim().length === 0) {
            return [];
        }

        const onResult = typeof onResultOrToken === 'function' ? onResultOrToken : undefined;
        const cancellationToken = onResult ? token : (onResultOrToken as CancellationToken);

        const { effectiveQuery, targetLine } = this.parseQueryWithLineNumber(query);

        if (effectiveQuery.trim().length === 0) {
            return [];
        }

        const normalizedQuery = effectiveQuery.replaceAll('\\', '/');
        const queryLower = normalizedQuery.toLowerCase();

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
            queryLower,
            maxResults,
            onResult,
            cancellationToken,
        );

        if (
            (scope === SearchScope.EVERYTHING || scope === SearchScope.ENDPOINTS) &&
            RouteMatcher.isPotentialUrl(queryLower)
        ) {
            const preparedQuery = RouteMatcher.prepare(queryLower);
            this.addUrlMatches(results, indices, preparedQuery, maxResults);
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
        token?: CancellationToken,
    ): SearchResult[] {
        const results: SearchResult[] = [];

        const addResult = (item: SearchableItem, typeId: number) => {
            const result: SearchResult = {
                item,
                score: this.applyItemTypeBoost(1, typeId),
                scope: ID_TO_SCOPE[typeId],
            };
            results.push(result);
            if (onResult && !token?.isCancellationRequested) {
                onResult(result);
            }
        };

        const processItem = (i: number) => {
            // Check max results break
            if (results.length >= maxResults) return;

            // Optimization: Check parallel array match BEFORE accessing the full item object
            // This prevents cache misses for non-matching items
            const prepared = this.preparedNames[i];

            if (prepared) {
                // Access internal lowercased string from Fuzzysort prepared object
                // to avoid storing a duplicate array of strings
                const cachedName = (prepared as unknown as ExtendedPrepared)._targetLower;

                // Fast path
                if (cachedName === queryLower || cachedName.startsWith(queryLower)) {
                    const item = this.items[i];
                    if (item) addResult(item, this.itemTypeIds[i]);
                }
            } else {
                // Slow path (Fallback if cache missing)
                const item = this.items[i];
                if (item) {
                    const name = item.name.toLowerCase();
                    if (name === queryLower || name.startsWith(queryLower)) {
                        addResult(item, this.itemTypeIds[i]);
                    }
                }
            }
        };

        if (indices) {
            for (const index of indices) {
                if (results.length >= maxResults || token?.isCancellationRequested) break;
                processItem(index);
            }
        } else {
            for (let i = 0; i < this.items.length; i++) {
                if (results.length >= maxResults || token?.isCancellationRequested) break;
                processItem(i);
            }
        }

        return results;
    }

    private parseQueryWithLineNumber(query: string): { effectiveQuery: string; targetLine?: number } {
        const lineMatch = /^(.*?):(\d+)$/.exec(query);
        if (lineMatch) {
            const effectiveQuery = lineMatch[1];
            const line = Number.parseInt(lineMatch[2], 10);
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
        queryOrPrepared: string | PreparedPath,
        maxResults?: number,
    ): void {
        const existingIds = new Set(results.map((r) => r.item.id));

        const checkItem = (i: number) => {
            if (maxResults && results.length >= maxResults) return;

            const item = this.items[i];
            if (item.type === SearchItemType.ENDPOINT && !existingIds.has(item.id)) {
                const pattern = this.preparedPatterns[i];
                const score = pattern
                    ? RouteMatcher.scoreMatchPattern(pattern, queryOrPrepared)
                    : RouteMatcher.scoreMatch(item.name, queryOrPrepared);

                if (score > 0) {
                    results.push({
                        item,
                        score,
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

function escapeRegExp(string: string): string {
    return string.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
