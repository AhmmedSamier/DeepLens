import * as cp from 'child_process';
import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { Config } from './config';
import { IndexerEnvironment } from './indexer-interfaces';
import { SearchableItem, SearchItemType } from './types';

export class CancellationError extends Error {
    constructor(message: string = 'Operation cancelled') {
        super(message);
        this.name = 'CancellationError';
    }
}

interface WorkerPoolState {
    pendingItems: SearchableItem[];
    activeTasks: number;
    finished: boolean;
    processed: number;
    nextReportingPercentage: number;
    logged100: boolean;
    resolveAll: () => void;
}

/**
 * Workspace indexer that scans files and extracts symbols
 */
export class WorkspaceIndexer {
    private onItemsAddedListeners: ((items: SearchableItem[]) => void)[] = [];
    private onItemsRemovedListeners: ((filePath: string) => void)[] = [];

    private indexing: boolean = false;
    private cancellationToken = { cancelled: false };
    private watchersActive: boolean = true;
    private watcherCooldownTimer: NodeJS.Timeout | undefined;
    private config: Config;
    private fileWatcher: { dispose(): void } | undefined;
    private treeSitter: import('./tree-sitter-parser').TreeSitterParser;
    private env: IndexerEnvironment;
    private stringCache: Map<string, string> = new Map();
    private extensionPath: string;
    private lastIndexTimestamp: number | null = null;
    private excludeMatchers: Minimatch[] = [];
    private workers: Worker[] = [];
    private workersInitialized: boolean = false;
    private fileHashes: Map<string, string> = new Map();

    // Batched git check queue
    private gitCheckQueue: Map<string, Set<string>> = new Map();
    private gitCheckResolvers: Map<string, ((ignored: boolean) => void)[]> = new Map();
    private gitCheckTimer: NodeJS.Timeout | undefined;

    constructor(
        config: Config,
        treeSitter: import('./tree-sitter-parser').TreeSitterParser,
        env: IndexerEnvironment,
        extensionPath: string,
    ) {
        this.config = config;
        this.treeSitter = treeSitter;
        this.env = env;
        this.extensionPath = extensionPath;
        this.updateExcludeMatchers();
    }

    /**
     * Proactively initialize workers and Tree-sitter to speed up first index
     */
    public async warmup(): Promise<void> {
        if (this.workersInitialized) return;
        this.log('Warming up indexing workers...');
        this.getWorkers();
    }

    private getWorkers(): Worker[] {
        if (this.workersInitialized) {
            return this.workers;
        }

        let workerCount = this.config.getIndexWorkerCount();
        if (workerCount <= 0) {
            const cpuCount = os.cpus().length;
            workerCount = Math.max(1, Math.min(cpuCount - 1, 8));
        }

        const possibleScripts = [
            path.join(this.extensionPath, 'dist', 'indexer-worker.js'), // Production path
            path.join(__dirname, 'indexer-worker.js'), // Relative to current file (prod)
        ];

        if ('Bun' in globalThis) {
            possibleScripts.push(path.join(__dirname, 'indexer-worker.ts'));
        }

        let workerScript = '';
        for (const script of possibleScripts) {
            if (fs.existsSync(script)) {
                workerScript = script;
                break;
            }
        }

        if (!workerScript) {
            this.log(`ERROR: Worker script not found. Searched in: ${possibleScripts.join(', ')}`);
            return [];
        }

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(workerScript, {
                workerData: { extensionPath: this.extensionPath },
            });
            worker.on('error', (err) => {
                this.log(`Worker ${i} error: ${err}`);
            });
            this.workers.push(worker);
        }

        this.workersInitialized = true;
        return this.workers;
    }

    private updateExcludeMatchers(): void {
        const patterns = this.config.getExcludePatterns();
        this.excludeMatchers = patterns.map((p) => new Minimatch(p, { dot: true }));
    }

    public onItemsAdded(listener: (items: SearchableItem[]) => void) {
        this.onItemsAddedListeners.push(listener);
        return {
            dispose: () => {
                this.onItemsAddedListeners = this.onItemsAddedListeners.filter((l) => l !== listener);
            },
        };
    }

    public onItemsRemoved(listener: (filePath: string) => void) {
        this.onItemsRemovedListeners.push(listener);
        return {
            dispose: () => {
                this.onItemsRemovedListeners = this.onItemsRemovedListeners.filter((l) => l !== listener);
            },
        };
    }

    private fireItemsAdded(items: SearchableItem[]) {
        if (items.length === 0) return;
        for (const listener of this.onItemsAddedListeners) {
            listener(items);
        }
    }

    private fireItemsRemoved(filePath: string) {
        for (const listener of this.onItemsRemovedListeners) {
            listener(filePath);
        }
    }

    /**
     * Cancel the current indexing operation if one is running
     */
    public cancel(): void {
        if (this.indexing) {
            this.log('Cancelling indexing operation...');
            this.cancellationToken.cancelled = true;
        }
    }

    async indexWorkspace(progressCallback?: (message: string, increment?: number) => void): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.cancellationToken = { cancelled: false };
        this.stringCache.clear();
        this.updateExcludeMatchers();

        try {
            const workspaceFolders = this.env.getWorkspaceFolders();
            if (workspaceFolders.length === 0) {
                return;
            }

            if (this.cancellationToken.cancelled) throw new CancellationError();

            this.log('Step 1/4: Analyzing repository structure...');
            progressCallback?.('Analyzing repository structure...', 10);

            // Step 2: Index files (Always fresh)
            this.log('Step 2/4: Scanning workspace files...');
            progressCallback?.('Scanning files...', 10);
            const fileItems: SearchableItem[] = [];

            if (this.cancellationToken.cancelled) throw new CancellationError();

            await this.indexFiles((items) => {
                fileItems.push(...items);
                this.fireItemsAdded(items);
            });

            if (this.cancellationToken.cancelled) throw new CancellationError();

            // Step 3: Index symbols
            this.log(`Step 3/4: Extracting symbols from ${fileItems.length} files...`);
            let reportedStepProgress = 0;

            await this.indexSymbols(fileItems, (message, totalPercentage) => {
                if (totalPercentage !== undefined) {
                    // Symbol extraction gets 70% of progress
                    const targetStepProgress = totalPercentage * 0.7;
                    const delta = targetStepProgress - reportedStepProgress;
                    if (delta > 0) {
                        progressCallback?.(message, delta);
                        reportedStepProgress = targetStepProgress;
                    } else {
                        progressCallback?.(message);
                    }
                } else {
                    progressCallback?.(message);
                }
            });

            if (this.cancellationToken.cancelled) throw new CancellationError();

            // Step 4: Finalize
            this.log('Step 4/4: Setting up file watchers...');
            progressCallback?.('Finalizing...', 10);
            this.setupFileWatchers();

            this.log('Index Workspace complete.');
            this.lastIndexTimestamp = Date.now();
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Check if indexing is in progress
     */
    isIndexing(): boolean {
        return this.indexing;
    }

    getLastIndexTimestamp(): number | null {
        return this.lastIndexTimestamp;
    }

    /**
     * Index all files in workspace
     */
    private async indexFiles(collector: (items: SearchableItem[]) => void): Promise<void> {
        // TURBO PATH: Try to use git ls-files for instant listing if it's a git repo
        const gitFiles = await this.listGitFiles();
        if (gitFiles.length > 0) {
            this.log('Using git for indexing: true');
            await this.processFileList(gitFiles, collector);
            return;
        }

        this.log('Using git for indexing: false');

        // STANDARD FALLBACK
        const excludePatterns = this.config.getExcludePatterns();
        const includePattern = `**/*`;

        // LSP client or VS Code provides the implementation
        const excludePattern = `{${excludePatterns.join(',')}}`;
        const files = await this.env.findFiles(includePattern, excludePattern);

        await this.processFileList(files, collector);
    }

    /**
     * List files using git (much faster than walking disk)
     */
    private async listGitFiles(): Promise<string[]> {
        const workspaceFolders = this.env.getWorkspaceFolders();
        if (workspaceFolders.length === 0) {
            return [];
        }

        const limit = pLimit(50); // Consistent with processFileList concurrency

        const folderPromises = workspaceFolders.map((folderPath) =>
            limit(async () => {
                try {
                    // Get both tracked and untracked (but not ignored) files
                    const output = await this.execGit(
                        ['ls-files', '--cached', '--others', '--exclude-standard'],
                        folderPath,
                    );

                    const lines = output.split('\n');
                    const folderResults: string[] = [];

                    for (const rawLine of lines) {
                        const line = rawLine.trim();
                        if (!line) {
                            continue;
                        }

                        const fullPath = path.isAbsolute(line) ? line : path.join(folderPath, line);
                        folderResults.push(this.intern(fullPath));
                    }
                    return folderResults;
                } catch (error) {
                    // Not a git repo or git not installed
                    console.debug(`Git file listing failed for ${folderPath}:`, error);
                    return [];
                }
            }),
        );

        const allResults = await Promise.all(folderPromises);
        return allResults.flat();
    }

    /**
     * Process a list of file paths into searchable items in parallel
     */
    private async processFileList(files: string[], collector: (items: SearchableItem[]) => void): Promise<void> {
        const CONCURRENCY = 50; // Reduced to 50 to avoid EMFILE on some systems
        const limit = pLimit(CONCURRENCY);

        let batch: SearchableItem[] = [];

        await Promise.all(
            files.map((filePath) =>
                limit(async () => {
                    if (this.cancellationToken.cancelled) {
                        return;
                    }

                    // Skip C# auto-generated files in parallel
                    if (filePath.endsWith('.cs')) {
                        const isAutoGenerated = await this.isAutoGeneratedFile(filePath);
                        if (isAutoGenerated) {
                            return;
                        }
                    }

                    const fileName = path.basename(filePath);
                    const relativePath = this.intern(this.env.asRelativePath(filePath));
                    const internedFilePath = this.intern(filePath);
                    const internedFileName = this.intern(fileName);
                    const size = await this.getFileSize(filePath);

                    batch.push({
                        id: `file:${filePath}`,
                        name: internedFileName,
                        type: SearchItemType.FILE,
                        filePath: internedFilePath,
                        relativeFilePath: relativePath,
                        detail: relativePath,
                        fullName: relativePath,
                        size,
                    });

                    if (batch.length >= CONCURRENCY) {
                        collector(batch);
                        batch = [];
                    }
                }),
            ),
        );

        if (this.cancellationToken.cancelled) {
            throw new CancellationError();
        }

        if (batch.length > 0) {
            collector(batch);
        }
    }

    private async getFileSize(filePath: string): Promise<number | undefined> {
        let attempts = 0;
        while (attempts < 3) {
            try {
                const stats = await fs.promises.stat(filePath);
                return stats.size;
            } catch (error) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const err = error as any;
                // Retry only on file descriptor exhaustion or busy errors
                if (err.code === 'EMFILE' || err.code === 'ENFILE' || err.code === 'EBUSY') {
                    attempts++;
                    if (attempts >= 3) {
                        this.log(`Failed to get file size for ${filePath} after 3 attempts: ${err.message}`);
                        return undefined;
                    }
                    // Exponential backoff: 20ms, 80ms
                    await new Promise((resolve) => setTimeout(resolve, 20 * Math.pow(4, attempts - 1)));
                } else {
                    // Non-retriable error (e.g., file not found)
                    return undefined;
                }
            }
        }
        return undefined;
    }

    /**
     * Check if a file is auto-generated (C# files with // <auto-generated /> marker)
     * Optimized to avoid opening a full document
     */
    private async isAutoGeneratedFile(filePath: string): Promise<boolean> {
        let fd: fs.promises.FileHandle | undefined;
        try {
            fd = await fs.promises.open(filePath, 'r');
            const { buffer } = await fd.read(Buffer.alloc(1024), 0, 1024, 0);

            const content = buffer.toString('utf8');

            if (!content) {
                return false;
            }

            const firstLine = content.split('\n')[0].trim();

            // Check for common auto-generated markers in C#
            return (
                firstLine === '// <auto-generated />' ||
                firstLine === '// <auto-generated/>' ||
                firstLine.startsWith('// <auto-generated>') ||
                content.includes('<auto-generated') // Some files have it later or in a header block
            );
        } catch (error) {
            console.debug(`Auto-generated check failed for ${filePath}:`, error);
            return false;
        } finally {
            if (fd) {
                try {
                    await fd.close();
                } catch (closeError) {
                    console.debug(`Failed to close file handle for ${filePath}:`, closeError);
                }
            }
        }
    }

    /**
     * Index symbols from all files with optimized concurrency (Sliding Window)
     */
    private async indexSymbols(
        fileItems: SearchableItem[],
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        const totalFiles = fileItems.length;

        if (totalFiles === 0) {
            return;
        }

        // Run both passes concurrently
        await Promise.all([
            // HIGH-PERFORMANCE PASS 1: Try workspace-wide symbol extraction
            this.scanWorkspaceSymbols(progressCallback),

            // HIGH-PERFORMANCE PASS 2: Worker Thread Pool
            this.runFileIndexingPool(fileItems, progressCallback),
        ]);
    }

    /**
     * Perform workspace-wide symbol extraction pass
     */
    private async scanWorkspaceSymbols(
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        progressCallback?.('Fast-scanning workspace symbols...', 5);
        if (!this.env.executeWorkspaceSymbolProvider) return;

        try {
            const workspaceSymbols = await this.env.executeWorkspaceSymbolProvider();

            if (workspaceSymbols && workspaceSymbols.length > 0) {
                await this.processWorkspaceSymbols(workspaceSymbols);
            }
        } catch (error) {
            console.debug('Workspace symbol pass failed, moving to file-by-file:', error);
        }
    }

    private async runFileIndexingPool(
        fileItems: SearchableItem[],
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        const totalFiles = fileItems.length;
        const batchSize = 100;

        const workers = this.getWorkers();
        if (workers.length === 0) {
            this.log(`No indexing workers available. Falling back to main thread.`);
            return this.runFileIndexingFallback(fileItems, progressCallback);
        }

        this.log(`Using ${workers.length} persistent indexing workers...`);

        const state: WorkerPoolState = {
            pendingItems: [...fileItems],
            activeTasks: 0,
            finished: false,
            processed: 0,
            nextReportingPercentage: 0,
            logged100: false,
            resolveAll: () => {},
        };

        try {
            const promise = new Promise<void>((resolve) => {
                state.resolveAll = resolve;
            });

            const cleanupListeners = this.setupWorkerPoolListeners(
                workers,
                totalFiles,
                state,
                progressCallback,
                batchSize,
            );
            this.startInitialWorkerTasks(workers, state, batchSize);
            await promise;
            this.cleanupWorkerPoolListeners(cleanupListeners);
        } catch (error) {
            this.log(`Worker pool failed: ${error}. Falling back to main thread.`);
            return this.runFileIndexingFallback(fileItems, progressCallback);
        }
    }

    private setupWorkerPoolListeners(
        workers: Worker[],
        totalFiles: number,
        state: WorkerPoolState,
        progressCallback: ((message: string, increment?: number) => void) | undefined,
        batchSize: number,
    ): (() => void)[] {
        const cleanupListeners: (() => void)[] = [];

        for (const worker of workers) {
            const onMessage = (message: {
                type: string;
                items?: SearchableItem[];
                count?: number;
                isPartial?: boolean;
            }) => {
                this.handleWorkerMessage(message, worker, state, totalFiles, progressCallback, batchSize);
            };

            worker.on('message', onMessage);
            cleanupListeners.push(() => worker.removeListener('message', onMessage));
        }

        return cleanupListeners;
    }

    private startInitialWorkerTasks(workers: Worker[], state: WorkerPoolState, batchSize: number): void {
        const initialCount = Math.min(workers.length, state.pendingItems.length);
        if (initialCount === 0) {
            state.finished = true;
            state.resolveAll();
            return;
        }

        for (let i = 0; i < initialCount; i++) {
            this.assignWorkerTask(workers[i], batchSize, state);
        }
    }

    private cleanupWorkerPoolListeners(cleanupListeners: (() => void)[]): void {
        for (const cleanup of cleanupListeners) {
            cleanup();
        }
    }

    private assignWorkerTask(worker: Worker, batchSize: number, state: WorkerPoolState): void {
        if (state.finished) {
            return;
        }

        if (this.cancellationToken.cancelled) {
            if (state.activeTasks === 0) {
                state.finished = true;
                state.resolveAll();
            }
            return;
        }

        const batchFiles: string[] = [];

        state.activeTasks++;

        try {
            while (state.pendingItems.length > 0 && batchFiles.length < batchSize) {
                const fileItem = state.pendingItems.shift()!;
                batchFiles.push(fileItem.filePath);
            }

            if (batchFiles.length > 0) {
                worker.postMessage({ filePaths: batchFiles });
            } else {
                state.activeTasks--;
                if (state.activeTasks === 0 && state.pendingItems.length === 0 && !state.finished) {
                    state.finished = true;
                    state.resolveAll();
                }
            }
        } catch (error) {
            this.log(`Error assigning task: ${error}`);
            state.activeTasks--;
            if (state.activeTasks === 0 && state.pendingItems.length === 0 && !state.finished) {
                state.finished = true;
                state.resolveAll();
            }
        }
    }

    private handleWorkerMessage(
        message: {
            type: string;
            items?: SearchableItem[];
            count?: number;
            isPartial?: boolean;
        },
        worker: Worker,
        state: WorkerPoolState,
        totalFiles: number,
        progressCallback: ((message: string, increment?: number) => void) | undefined,
        batchSize: number,
    ): void {
        if (this.handleCancelledWorkerMessage(message, state)) {
            return;
        }

        if (message.type === 'result') {
            this.handleWorkerResultMessage(message, worker, state, totalFiles, progressCallback, batchSize);
        } else if (message.type === 'error') {
            this.handleWorkerErrorMessage(worker, state, batchSize);
        }
    }

    private handleCancelledWorkerMessage(
        message: {
            type: string;
            items?: SearchableItem[];
            count?: number;
            isPartial?: boolean;
        },
        state: WorkerPoolState,
    ): boolean {
        if (!this.cancellationToken.cancelled || state.finished) {
            return false;
        }

        if ((message.type === 'result' || message.type === 'error') && !message.isPartial) {
            state.activeTasks--;
            if (state.activeTasks === 0) {
                state.finished = true;
                state.resolveAll();
            }
        }

        return true;
    }

    private handleWorkerResultMessage(
        message: {
            type: string;
            items?: SearchableItem[];
            count?: number;
            isPartial?: boolean;
        },
        worker: Worker,
        state: WorkerPoolState,
        totalFiles: number,
        progressCallback: ((message: string, increment?: number) => void) | undefined,
        batchSize: number,
    ): void {
        const { items, count, isPartial } = message;

        if (items && items.length > 0) {
            const processItems = () => {
                const internedItems = items.map((item: SearchableItem) => ({
                    ...item,
                    name: this.intern(item.name),
                    fullName: item.fullName ? this.intern(item.fullName) : undefined,
                    containerName: item.containerName ? this.intern(item.containerName) : undefined,
                    relativeFilePath: item.relativeFilePath ? this.intern(item.relativeFilePath) : undefined,
                    filePath: this.intern(item.filePath),
                }));
                this.fireItemsAdded(internedItems);
            };

            if (items.length > 100) {
                setTimeout(processItems, 0);
            } else {
                processItems();
            }
        }

        const itemsProcessed = count || 1;
        state.processed += itemsProcessed;

        if (!isPartial) {
            state.activeTasks--;
        }

        this.updateWorkerProgress(
            totalFiles,
            itemsProcessed,
            () => state.processed,
            () => state.logged100,
            (v) => (state.logged100 = v),
            () => state.nextReportingPercentage,
            (v) => (state.nextReportingPercentage = v),
            progressCallback,
        );

        if (isPartial) {
            return;
        }

        if (state.pendingItems.length > 0) {
            this.assignWorkerTask(worker, batchSize, state);
        } else if (state.activeTasks === 0 && !state.finished) {
            state.finished = true;
            state.resolveAll();
        }
    }

    private handleWorkerErrorMessage(worker: Worker, state: WorkerPoolState, batchSize: number): void {
        state.activeTasks--;
        if (state.pendingItems.length > 0) {
            this.assignWorkerTask(worker, batchSize, state);
        } else if (state.activeTasks === 0 && !state.finished) {
            state.finished = true;
            state.resolveAll();
        }
    }

    private updateWorkerProgress(
        totalFiles: number,
        itemsProcessed: number,
        getProcessed: () => number,
        getLogged100: () => boolean,
        setLogged100: (v: boolean) => void,
        getNextReportingPercentage: () => number,
        setNextReportingPercentage: (v: number) => void,
        progressCallback: ((message: string, increment?: number) => void) | undefined,
    ) {
        const processed = getProcessed();
        const logged100 = getLogged100();

        if (processed % 100 < itemsProcessed || (processed === totalFiles && !logged100)) {
            if (processed >= totalFiles) {
                setLogged100(true);
            }
            this.log(
                `Extraction progress: ${processed}/${totalFiles} files (${Math.round((processed / totalFiles) * 100)}%)`,
            );
        }

        if (progressCallback) {
            const percentage = (processed / totalFiles) * 100;
            const nextReportingPercentage = getNextReportingPercentage();
            if (percentage >= nextReportingPercentage || processed === totalFiles) {
                progressCallback(`Indexing batch... (${processed}/${totalFiles})`, percentage);
                setNextReportingPercentage(percentage + 5);
            }
        }
    }

    /**
     * Process symbols from workspace provider
     */
    private async processWorkspaceSymbols(
        symbols: import('./indexer-interfaces').LeanSymbolInformation[],
    ): Promise<void> {
        const batch: SearchableItem[] = [];

        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (!itemType) {
                continue;
            }

            const filePath = this.normalizeUriToPath(symbol.location.uri);
            const id = `symbol:${filePath}:${symbol.name}:${symbol.location.range.start.line}`;
            const item: SearchableItem = {
                id,
                name: symbol.name,
                type: itemType,
                filePath,
                relativeFilePath: this.env.asRelativePath(filePath),
                line: symbol.location.range.start.line,
                column: symbol.location.range.start.character,
                containerName: symbol.containerName,
                fullName: symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name,
            };

            batch.push(item);
        }

        this.fireItemsAdded(batch);
    }

    private normalizeUriToPath(uriOrPath: string): string {
        if (uriOrPath.startsWith('file://')) {
            try {
                return fileURLToPath(uriOrPath);
            } catch {
                return uriOrPath;
            }
        }
        return uriOrPath;
    }

    /**
     * Process symbols recursively
     */
    private processSymbols(
        symbols: import('./indexer-interfaces').LeanDocumentSymbol[],
        filePath: string, // Expected to be interned by caller
        relativeFilePath: string, // Expected to be interned by caller
        collector: SearchableItem[],
        containerName?: string,
    ): void {
        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (itemType) {
                const name = this.intern(symbol.name);
                const internedContainerName = containerName ? this.intern(containerName) : undefined;
                const fullName = this.intern(containerName ? `${containerName}.${symbol.name}` : symbol.name);

                collector.push({
                    id: `symbol:${filePath}:${fullName}:${symbol.range.start.line}`,
                    name: name,
                    type: itemType,
                    filePath,
                    relativeFilePath,
                    line: symbol.range.start.line,
                    column: symbol.range.start.character,
                    containerName: internedContainerName,
                    fullName,
                    detail: symbol.detail,
                });
            }

            // Process nested symbols
            if (symbol.children && symbol.children.length > 0) {
                const newContainerName = containerName ? `${containerName}.${symbol.name}` : symbol.name;
                this.processSymbols(symbol.children, filePath, relativeFilePath, collector, newContainerName);
            }
        }
    }

    /**
     * Map SymbolKind to our SearchItemType
     */
    private mapSymbolKindToItemType(kind: number): SearchItemType | null {
        // Based on VS Code SymbolKind enum values
        switch (kind) {
            case 4: // Class
                return SearchItemType.CLASS;
            case 10: // Interface
                return SearchItemType.INTERFACE;
            case 9: // Enum
                return SearchItemType.ENUM;
            case 11: // Function
                return SearchItemType.FUNCTION;
            case 5: // Method
                return SearchItemType.METHOD;
            case 6: // Property
            case 7: // Field
                return SearchItemType.PROPERTY;
            case 12: // Variable
            case 13: // Constant
                return SearchItemType.VARIABLE;
            default:
                return null; // Skip other symbol kinds
        }
    }

    private async runFileIndexingFallback(
        fileItems: SearchableItem[],
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        const totalFiles = fileItems.length;
        let processed = 0;
        let nextReportingPercentage = 0;

        const CONCURRENCY = 50;
        const limit = pLimit(CONCURRENCY);

        await Promise.all(
            fileItems.map((fileItem) =>
                limit(async () => {
                    await this.indexFileSymbols(fileItem.filePath);
                    processed++;

                    if (progressCallback) {
                        const percentage = (processed / totalFiles) * 100;
                        if (percentage >= nextReportingPercentage || processed === totalFiles) {
                            progressCallback(`Indexing symbols... (${processed}/${totalFiles})`, percentage);
                            nextReportingPercentage = percentage + 5;
                        }
                    }
                }),
            ),
        );
    }

    private async indexFileSymbols(filePath: string): Promise<void> {
        try {
            await this.treeSitter.init();
            const items = await this.treeSitter.parseFile(filePath);
            if (items.length > 0) {
                this.fireItemsAdded(items);
            }
        } catch (error) {
            this.log(`Error indexing symbols for ${filePath}: ${error}`);
        }
    }

    /**
     * Setup file watchers for incremental updates
     */
    private setupFileWatchers(): void {
        this.fileWatcher?.dispose();
        if (!this.env.createFileSystemWatcher) return;

        // Watch all files
        const pattern = `**/*`;

        this.fileWatcher = this.env.createFileSystemWatcher(pattern, (filePath, type) => {
            switch (type) {
                case 'create':
                    this.handleFileCreated(filePath);
                    break;
                case 'change':
                    this.handleFileChanged(filePath);
                    break;
                case 'delete':
                    this.handleFileDeleted(filePath);
                    break;
            }
        });
    }

    /**
     * Check if a file should be excluded based on config patterns
     */
    private shouldExcludeFile(filePath: string): boolean {
        const relativePath = this.env.asRelativePath(filePath);
        // Normalize to forward slashes for matching
        const normalizedPath = relativePath.replace(/\\/g, '/');

        return this.excludeMatchers.some((matcher) => matcher.match(normalizedPath));
    }

    /**
     * Check if a file is ignored by git
     */
    private isGitIgnored(filePath: string): Promise<boolean> {
        if (!this.config.shouldRespectGitignore()) {
            return Promise.resolve(false);
        }

        const workspaceFolders = this.env.getWorkspaceFolders();
        const folder = workspaceFolders.find((f) => filePath.startsWith(f));
        if (!folder) {
            return Promise.resolve(false);
        }

        // Add to queue for batch processing
        let folderQueue = this.gitCheckQueue.get(folder);
        if (!folderQueue) {
            folderQueue = new Set();
            this.gitCheckQueue.set(folder, folderQueue);
        }
        folderQueue.add(filePath);

        // Create promise
        return new Promise<boolean>((resolve) => {
            let resolvers = this.gitCheckResolvers.get(filePath);
            if (!resolvers) {
                resolvers = [];
                this.gitCheckResolvers.set(filePath, resolvers);
            }
            resolvers.push(resolve);

            this.scheduleGitCheck();
        });
    }

    private scheduleGitCheck() {
        if (this.gitCheckTimer) {
            return;
        }
        // Debounce for 50ms to collect file events
        this.gitCheckTimer = setTimeout(() => this.processGitChecks(), 50);
    }

    private async processGitChecks() {
        this.gitCheckTimer = undefined;

        const queue = new Map(this.gitCheckQueue);
        this.gitCheckQueue.clear();

        for (const [folder, files] of queue) {
            if (files.size === 0) continue;

            const filesArray = Array.from(files);
            await this.processGitCheckBatch(folder, filesArray);
        }
    }

    private async processGitCheckBatch(folder: string, filesArray: string[]): Promise<void> {
        try {
            const input = filesArray.join('\0');
            const output = await this.execGit(['check-ignore', '-v', '-n', '-z', '--stdin'], folder, input);

            const parts = output.split('\0');
            const ignoredFiles = new Set<string>();

            for (let i = 0; i < parts.length - 1; i += 4) {
                const source = parts[i];
                const pathName = parts[i + 3];

                if (source && source.length > 0) {
                    const absolutePath = path.isAbsolute(pathName) ? pathName : path.join(folder, pathName);
                    ignoredFiles.add(absolutePath);
                }
            }

            for (const filePath of filesArray) {
                const isIgnored = ignoredFiles.has(filePath);
                this.resolveGitCheck(filePath, isIgnored);
            }
        } catch (error) {
            console.error(`Git check-ignore batch failed for ${folder}:`, error);
            for (const filePath of filesArray) {
                this.resolveGitCheck(filePath, false);
            }
        }
    }

    private resolveGitCheck(filePath: string, isIgnored: boolean) {
        const resolvers = this.gitCheckResolvers.get(filePath);
        if (resolvers) {
            for (const resolve of resolvers) {
                resolve(isIgnored);
            }
            this.gitCheckResolvers.delete(filePath);
        }
    }

    /**
     * Handle file created
     */
    private async handleFileCreated(filePath: string): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip during full re-index or cooldown
        }

        if (this.shouldExcludeFile(filePath)) {
            return;
        }

        if (await this.isGitIgnored(filePath)) {
            return;
        }

        const fileName = path.basename(filePath);
        const relativePath = this.intern(this.env.asRelativePath(filePath));
        const internedFilePath = this.intern(filePath);
        const internedFileName = this.intern(fileName);

        // Add file item
        const fileItem: SearchableItem = {
            id: `file:${filePath}`,
            name: internedFileName,
            type: SearchItemType.FILE,
            filePath: internedFilePath,
            detail: relativePath,
            fullName: relativePath,
            size: await this.getFileSize(filePath),
        };
        this.fireItemsAdded([fileItem]);

        // Index symbols
        await this.indexFileSymbols(filePath);

        this.log(`Indexed new file: ${relativePath}`);
    }

    /**
     * Handle file changed
     */
    private async handleFileChanged(filePath: string): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip individual updates during full re-index or cooldown
        }

        if (this.shouldExcludeFile(filePath)) {
            return;
        }

        if (await this.isGitIgnored(filePath)) {
            return;
        }

        // Remove old symbols for this file
        this.fireItemsRemoved(filePath);

        // Invalidate hash to force re-calculation
        this.fileHashes.delete(filePath);

        // Re-add file item with updated size
        const fileName = path.basename(filePath);
        const relativePath = this.intern(this.env.asRelativePath(filePath));
        const internedFilePath = this.intern(filePath);
        const internedFileName = this.intern(fileName);

        const fileItem: SearchableItem = {
            id: `file:${filePath}`,
            name: internedFileName,
            type: SearchItemType.FILE,
            filePath: internedFilePath,
            detail: relativePath,
            fullName: relativePath,
            size: await this.getFileSize(filePath),
        };
        this.fireItemsAdded([fileItem]);

        // Re-index symbols (it will check cache internally)
        await this.indexFileSymbols(filePath);
    }

    /**
     * Handle file deleted
     */
    private handleFileDeleted(filePath: string): void {
        if (this.shouldExcludeFile(filePath)) {
            return;
        }

        // Remove all items for this file
        this.fireItemsRemoved(filePath);
    }

    /**
     * Incrementally sync the index based on git changes (e.g., branch switch)
     */
    /**
     * Disable file watchers for a short period after a full index
     * to prevent Git "checkout" event storms from causing redundant work.
     */
    public cooldownFileWatchers(ms: number = 5000): void {
        this.watchersActive = false;
        if (this.watcherCooldownTimer) {
            clearTimeout(this.watcherCooldownTimer);
        }
        this.watcherCooldownTimer = setTimeout(() => {
            this.watchersActive = true;
            this.watcherCooldownTimer = undefined;
        }, ms);
    }

    public log(message: string): void {
        this.env.log(message);
    }

    /**
     * Reset internal caches for a forced full rebuild.
     */
    public resetCaches(): void {
        this.stringCache.clear();
        this.fileHashes.clear();
    }

    /**
     * Intern a string to save memory
     */
    private intern(str: string): string {
        const cached = this.stringCache.get(str);
        if (cached) {
            return cached;
        }
        this.stringCache.set(str, str);
        return str;
    }

    /**
     * Execute a git command (abstracted for testing and reuse)
     * Uses execFile to avoid shell injection vulnerabilities
     */
    protected async execGit(args: string[], cwd: string, input?: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd });

            let settled = false;
            const timeoutMs = 10000;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    child.kill();
                    reject(new Error(`Git command timed out after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            if (input) {
                child.stdin.write(input);
                child.stdin.end();
            }

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (err) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                reject(err);
            });

            child.on('close', (code) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git exited with code ${code}: ${stderr}`));
                }
            });
        });
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.fileWatcher?.dispose();
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }
}

/**
 * Simple concurrency limiter for Promise execution
 */
function pLimit(concurrency: number) {
    const queue: (() => void)[] = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            queue.shift()!();
        }
    };

    const run = async <T>(fn: () => Promise<T>, resolve: (val: T) => void, reject: (err: unknown) => void) => {
        activeCount++;
        const result = (async () => fn())();
        try {
            const res = await result;
            resolve(res);
        } catch (err) {
            reject(err);
        }
        next();
    };

    const enqueue = <T>(fn: () => Promise<T>, resolve: (val: T) => void, reject: (err: unknown) => void) => {
        queue.push(() => run(fn, resolve, reject));
        if (activeCount < concurrency && queue.length > 0) {
            queue.shift()!();
        }
    };

    return <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => enqueue(fn, resolve, reject));
}
