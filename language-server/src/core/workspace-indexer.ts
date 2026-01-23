import * as cp from 'child_process';
import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { Config } from './config';
import { IndexerEnvironment } from './indexer-interfaces';
import { SearchableItem, SearchItemType } from './types';

/**
 * Workspace indexer that scans files and extracts symbols
 */
export class WorkspaceIndexer {
    private onItemsAddedListeners: ((items: SearchableItem[]) => void)[] = [];
    private onItemsRemovedListeners: ((filePath: string) => void)[] = [];

    private indexing: boolean = false;
    private watchersActive: boolean = true;
    private watcherCooldownTimer: NodeJS.Timeout | undefined;
    private config: Config;
    private fileWatcher: { dispose(): void } | undefined;
    private treeSitter: import('./tree-sitter-parser').TreeSitterParser;
    private env: IndexerEnvironment;
    private stringCache: Map<string, string> = new Map();
    private extensionPath: string;
    private excludeMatchers: Minimatch[] = [];
    private workers: Worker[] = [];
    private workersInitialized: boolean = false;
    private fileHashes: Map<string, string> = new Map();

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

        const workerCount = Math.max(1, os.cpus().length - 1);

        // Try to find the worker script in multiple locations
        // We prioritize .js because Node.js (VS Code) cannot run .ts directly in workers
        const possibleScripts = [
            path.join(this.extensionPath, 'dist', 'indexer-worker.js'), // Production path
            path.join(__dirname, 'indexer-worker.js'), // Relative to current file (prod)
        ];

        // Only add .ts if we are running in Bun
        if (typeof Bun !== 'undefined') {
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

    async indexWorkspace(progressCallback?: (message: string, increment?: number) => void): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.stringCache.clear();
        this.updateExcludeMatchers();

        try {
            const workspaceFolders = this.env.getWorkspaceFolders();
            if (workspaceFolders.length === 0) {
                return;
            }

            this.log('Step 1/4: Analyzing repository structure...');
            progressCallback?.('Analyzing repository structure...', 10);

            // Step 2: Index files (Always fresh)
            this.log('Step 2/4: Scanning workspace files...');
            progressCallback?.('Scanning files...', 10);
            const fileItems: SearchableItem[] = [];
            await this.indexFiles((items) => {
                fileItems.push(...items);
                this.fireItemsAdded(items);
            });

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

            // Step 4: Finalize
            this.log('Step 4/4: Setting up file watchers...');
            progressCallback?.('Finalizing...', 10);
            this.setupFileWatchers();

            this.log('Index Workspace complete.');
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

        const results: string[] = [];
        for (const folderPath of workspaceFolders) {
            try {
                // Get both tracked and untracked (but not ignored) files
                const output = await this.execGit(
                    ['ls-files', '--cached', '--others', '--exclude-standard'],
                    folderPath,
                );

                const lines = output.split('\n');

                for (const line of lines) {
                    if (!line || line.trim() === '') {
                        continue;
                    }

                    const fullPath = path.join(folderPath, line);
                    results.push(fullPath);
                }
            } catch (error) {
                // Not a git repo or git not installed
                console.debug(`Git file listing failed for ${folderPath}:`, error);
            }
        }
        return results;
    }

    /**
     * Process a list of file paths into searchable items in parallel
     */
    private async processFileList(files: string[], collector: (items: SearchableItem[]) => void): Promise<void> {
        const CONCURRENCY = 100; // Higher concurrency for metadata checks
        const chunks: string[][] = [];

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            chunks.push(files.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
            const batch: SearchableItem[] = [];
            await Promise.all(
                chunk.map(async (filePath) => {
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

                    batch.push({
                        id: `file:${filePath}`,
                        name: internedFileName,
                        type: SearchItemType.FILE,
                        filePath: internedFilePath,
                        relativeFilePath: relativePath,
                        detail: relativePath,
                        fullName: relativePath,
                    });
                }),
            );
            if (batch.length > 0) {
                collector(batch);
            }
        }
    }

    /**
     * Check if a file is auto-generated (C# files with // <auto-generated /> marker)
     * Optimized to avoid opening a full document
     */
    private async isAutoGeneratedFile(filePath: string): Promise<boolean> {
        try {
            // Read only first 1KB to check for marker - much faster than reading full file
            const fd = await fs.promises.open(filePath, 'r');
            const { buffer } = await fd.read(Buffer.alloc(1024), 0, 1024, 0);
            await fd.close();

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

    /**
     * Run concurrent file-by-file indexing pool using Worker Threads
     */
    private async runFileIndexingPool(
        fileItems: SearchableItem[],
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        const totalFiles = fileItems.length;
        const BATCH_SIZE = 50;

        let processed = 0;
        let nextReportingPercentage = 0;
        let logged100 = false;

        const workers = this.getWorkers();
        if (workers.length === 0) {
            this.log(`No indexing workers available. Falling back to main thread.`);
            return this.runFileIndexingFallback(fileItems, progressCallback);
        }

        this.log(`Using ${workers.length} persistent indexing workers...`);

        try {
            const pendingItems = [...fileItems];
            let activeTasks = 0;
            let finished = false;
            let resolveAll: () => void;

            const promise = new Promise<void>((resolve) => {
                resolveAll = resolve;
            });

            const assignTask = async (worker: Worker) => {
                if (finished) return;

                const batchFiles: string[] = [];

                // We increment activeTasks BEFORE doing anything async to prevent premature resolution
                activeTasks++;

                try {
                    // Fill batch
                    while (pendingItems.length > 0 && batchFiles.length < BATCH_SIZE) {
                        const fileItem = pendingItems.shift()!;
                        batchFiles.push(fileItem.filePath);
                    }

                    if (batchFiles.length > 0) {
                        worker.postMessage({ filePaths: batchFiles });
                    } else {
                        // No items for this worker
                        activeTasks--;
                        if (activeTasks === 0 && pendingItems.length === 0 && !finished) {
                            finished = true;
                            resolveAll();
                        }
                    }
                } catch (err) {
                    this.log(`Error assigning task: ${err}`);
                    activeTasks--;
                    if (activeTasks === 0 && pendingItems.length === 0 && !finished) {
                        finished = true;
                        resolveAll();
                    }
                }
            };

            // Set up listeners for this run
            const cleanupListeners: (() => void)[] = [];

            for (let i = 0; i < workers.length; i++) {
                const worker = workers[i];

                const onMessage = (message: { type: string; items?: SearchableItem[]; count?: number }) => {
                    if (message.type === 'result') {
                        const { items, count } = message;

                        if (items && items.length > 0) {
                            const internedItems = items.map((item: SearchableItem) => ({
                                ...item,
                                name: this.intern(item.name),
                                fullName: item.fullName ? this.intern(item.fullName) : undefined,
                                containerName: item.containerName ? this.intern(item.containerName) : undefined,
                                relativeFilePath: item.relativeFilePath
                                    ? this.intern(item.relativeFilePath)
                                    : undefined,
                                filePath: this.intern(item.filePath),
                            }));
                            this.fireItemsAdded(internedItems);
                        }

                        const itemsProcessed = count || 1;
                        processed += itemsProcessed;
                        activeTasks--;

                        this.updateWorkerProgress(
                            totalFiles,
                            itemsProcessed,
                            () => processed,
                            () => logged100,
                            (v) => (logged100 = v),
                            () => nextReportingPercentage,
                            (v) => (nextReportingPercentage = v),
                            progressCallback,
                        );

                        if (pendingItems.length > 0) {
                            assignTask(worker);
                        } else if (activeTasks === 0 && !finished) {
                            finished = true;
                            resolveAll!();
                        }
                    } else if (message.type === 'error') {
                        activeTasks--;
                        if (pendingItems.length > 0) {
                            assignTask(worker);
                        } else if (activeTasks === 0 && !finished) {
                            finished = true;
                            resolveAll!();
                        }
                    }
                };

                worker.on('message', onMessage);
                cleanupListeners.push(() => worker.removeListener('message', onMessage));
            }

            // Start initial tasks
            const initialCount = Math.min(workers.length, pendingItems.length);
            if (initialCount === 0) {
                finished = true;
                resolveAll!();
            } else {
                for (let i = 0; i < initialCount; i++) {
                    assignTask(workers[i]);
                }
            }

            await promise;

            // Cleanup listeners so they don't fire on the next run
            for (const cleanup of cleanupListeners) {
                cleanup();
            }
        } catch (error) {
            this.log(`Worker pool failed: ${error}. Falling back to main thread.`);
            return this.runFileIndexingFallback(fileItems, progressCallback);
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

            const id = `symbol:${symbol.location.uri}:${symbol.name}:${symbol.location.range.start.line}`;
            const item: SearchableItem = {
                id,
                name: symbol.name,
                type: itemType,
                filePath: symbol.location.uri,
                relativeFilePath: this.env.asRelativePath(symbol.location.uri),
                line: symbol.location.range.start.line,
                column: symbol.location.range.start.character,
                containerName: symbol.containerName,
                fullName: symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name,
            };

            batch.push(item);
        }

        this.fireItemsAdded(batch);
    }

    private async populateFileHashes(): Promise<void> {
        // Redundant - can be removed entirely if desired, keeping only if needed elsewhere
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

        for (const fileItem of fileItems) {
            await this.indexFileSymbols(fileItem.filePath);
            processed++;

            if (progressCallback) {
                const percentage = (processed / totalFiles) * 100;
                if (percentage >= nextReportingPercentage || processed === totalFiles) {
                    progressCallback(`Indexing symbols... (${processed}/${totalFiles})`, percentage);
                    nextReportingPercentage = percentage + 5;
                }
            }
        }
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
    private async isGitIgnored(filePath: string): Promise<boolean> {
        if (!this.config.shouldRespectGitignore()) {
            return false;
        }

        const workspaceFolders = this.env.getWorkspaceFolders();
        const folder = workspaceFolders.find((f) => filePath.startsWith(f));
        if (!folder) {
            return false;
        }

        try {
            await this.execGit(['check-ignore', '-q', filePath], folder);
            // If exec succeeds (exit code 0), it is ignored
            return true;
        } catch {
            // If exit code is 1, it is NOT ignored.
            // If code is anything else (e.g. 128), git failed (not a repo?), so assume NOT ignored.
            return false;
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
    protected async execGit(args: string[], cwd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (code) => {
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
