import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { Minimatch } from 'minimatch';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { Config } from './config';
import { IndexPersistence } from './index-persistence';
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
    private persistence: IndexPersistence;
    private fileHashes: Map<string, string> = new Map();
    private env: IndexerEnvironment;
    private stringCache: Map<string, string> = new Map();
    private extensionPath: string;
    private excludeMatchers: Minimatch[] = [];

    constructor(
        config: Config,
        treeSitter: import('./tree-sitter-parser').TreeSitterParser,
        persistence: IndexPersistence,
        env: IndexerEnvironment,
        extensionPath: string,
    ) {
        this.config = config;
        this.treeSitter = treeSitter;
        this.persistence = persistence;
        this.env = env;
        this.extensionPath = extensionPath;
        this.updateExcludeMatchers();
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
     * Start indexing the workspace
     */
    async indexWorkspace(
        progressCallback?: (message: string, increment?: number) => void,
        force: boolean = false,
    ): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.stringCache.clear(); // Clear string cache on full re-index
        this.updateExcludeMatchers(); // Ensure matchers are up-to-date

        if (force) {
            await this.persistence.clear();
        }

        try {
            const workspaceFolders = this.env.getWorkspaceFolders();
            if (workspaceFolders.length === 0) {
                return;
            }

            // Load cache
            await this.persistence.load();

            // Try to get git hashes first (TURBO: used for metadata-free indexing)
            this.log('Step 1/5: Analyzing repository structure and file hashes...');
            progressCallback?.('Analyzing repository structure...', 5);
            await this.populateFileHashes();

            // Index files (PRO: now parallelized)
            this.log('Step 2/5: Scanning workspace files...');
            progressCallback?.('Scanning files...', 5);
            // We pass a collector callback to indexFiles
            const fileItems: SearchableItem[] = [];
            await this.indexFiles((items) => {
                fileItems.push(...items);
                this.fireItemsAdded(items);
            });

            // Index symbols from files
            this.log(`Step 3/5: Extracting symbols from ${fileItems.length} files...`);
            let reportedStepProgress = 0;

            // For symbols, we will emit them directly as they are found
            await this.indexSymbols(fileItems, (message, totalPercentage) => {
                if (totalPercentage !== undefined) {
                    // This step is allocated 80% of total progress (from 10% to 90%)
                    const targetStepProgress = totalPercentage * 0.8;
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

            // Save cache
            this.log('Step 4/5: Saving index cache...');
            progressCallback?.('Saving index cache...', 5);
            await this.persistence.save();

            // Set up file watchers for incremental updates
            this.log('Step 5/5: Setting up file watchers...');
            this.setupFileWatchers();

            this.log('Index Workspace complete.');

            // We can't log final summary count here easily without keeping track, but that's fine.
            this.log(`Final Index Summary: Completed.`);
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
            await this.processFileList(gitFiles, collector);
            return;
        }

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
                this.processWorkspaceSymbols(workspaceSymbols);
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
        const workerCount = Math.max(1, os.cpus().length - 1);
        const BATCH_SIZE = 50;

        let processed = 0;
        let nextReportingPercentage = 0;
        let logged100 = false;

        // Determine worker script path
        const isTs = __filename.endsWith('.ts');
        const workerScript = isTs
            ? path.join(__dirname, 'indexer-worker.ts')
            : path.join(__dirname, 'indexer-worker.js');

        this.log(`Starting ${workerCount} indexing workers (Script: ${path.basename(workerScript)})...`);

        try {
            // Verify worker script exists
            if (!fs.existsSync(workerScript)) {
                this.log(`Worker script not found at ${workerScript}. Falling back to main thread.`);
                return this.runFileIndexingFallback(fileItems, progressCallback);
            }

            const workers: Worker[] = [];
            const freeWorkers: Worker[] = [];
            const pendingItems = [...fileItems];
            let activeTasks = 0;
            let resolveAll: () => void;

            const promise = new Promise<void>((resolve) => {
                resolveAll = resolve;
            });

            // Initialize workers
            for (let i = 0; i < workerCount; i++) {
                const worker = new Worker(workerScript, {
                    workerData: { extensionPath: this.extensionPath },
                });

                this.setupWorkerListeners(
                    worker,
                    i,
                    totalFiles,
                    () => processed,
                    (p) => (processed = p),
                    () => activeTasks,
                    (a) => (activeTasks = a),
                    () => logged100,
                    (l) => (logged100 = l),
                    () => nextReportingPercentage,
                    (n) => (nextReportingPercentage = n),
                    progressCallback,
                    assignTask
                );

                workers.push(worker);
                freeWorkers.push(worker);
            }

            const assignTask = (worker: Worker) => {
                const batchFiles: string[] = [];

                // Fill batch
                while (pendingItems.length > 0 && batchFiles.length < BATCH_SIZE) {
                    const fileItem = pendingItems.shift()!;

                    // Check cache logic here
                    if (this.shouldSkipIndexing(fileItem.filePath)) {
                        processed++;
                        if (processed % 100 === 0) {
                            this.log(
                                `Extraction progress: ${processed}/${totalFiles} files (${Math.round((processed / totalFiles) * 100)}%)`,
                            );
                        }
                        continue;
                    }

                    batchFiles.push(fileItem.filePath);
                }

                if (batchFiles.length > 0) {
                    activeTasks++;
                    worker.postMessage({ filePaths: batchFiles });
                } else {
                    // No more tasks
                    freeWorkers.push(worker);
                    if (activeTasks === 0 && pendingItems.length === 0) {
                        terminateWorkers();
                        resolveAll();
                    }
                }
            };

            const terminateWorkers = () => {
                for (const w of workers) w.terminate();
            };

            // Start initial tasks
            while (freeWorkers.length > 0 && pendingItems.length > 0) {
                const w = freeWorkers.pop()!;
                assignTask(w);
            }

            // If we ran out of items before using all workers
            if (pendingItems.length === 0 && activeTasks === 0) {
                terminateWorkers();
                resolveAll();
            }

            await promise;
        } catch (error) {
            this.log(`Worker pool failed: ${error}. Falling back to main thread.`);
            return this.runFileIndexingFallback(fileItems, progressCallback);
        }
    }

    private setupWorkerListeners(
        worker: Worker,
        workerIndex: number,
        totalFiles: number,
        getProcessed: () => number,
        setProcessed: (v: number) => void,
        getActiveTasks: () => number,
        setActiveTasks: (v: number) => void,
        getLogged100: () => boolean,
        setLogged100: (v: boolean) => void,
        getNextReportingPercentage: () => number,
        setNextReportingPercentage: (v: number) => void,
        progressCallback: ((message: string, increment?: number) => void) | undefined,
        assignTask: (worker: Worker) => void
    ) {
        worker.on('message', (message) => {
            if (message.type === 'log') {
                // Log message handling
            } else if (message.type === 'result') {
                const { items, count } = message;
                if (items && items.length > 0) {
                    // Re-intern strings from worker to share memory in main thread
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

                // Mark task complete
                const itemsProcessed = count || 1;
                setProcessed(getProcessed() + itemsProcessed);
                setActiveTasks(getActiveTasks() - 1);

                this.updateWorkerProgress(
                    totalFiles,
                    itemsProcessed,
                    getProcessed,
                    getLogged100,
                    setLogged100,
                    getNextReportingPercentage,
                    setNextReportingPercentage,
                    progressCallback
                );

                // Pick next task
                assignTask(worker);
            } else if (message.type === 'error') {
                // Log error but continue
                setActiveTasks(getActiveTasks() - 1);
                assignTask(worker);
            }
        });

        worker.on('error', (err) => {
            this.log(`Worker ${workerIndex} error: ${err}`);
            // If a worker dies, we lose its capacity. Ideally restart it, but for now just ignore.
        });
    }

    private updateWorkerProgress(
        totalFiles: number,
        itemsProcessed: number,
        getProcessed: () => number,
        getLogged100: () => boolean,
        setLogged100: (v: boolean) => void,
        getNextReportingPercentage: () => number,
        setNextReportingPercentage: (v: number) => void,
        progressCallback: ((message: string, increment?: number) => void) | undefined
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
     * Check if we can skip indexing this file (cache hit)
     * Returns true if symbols were loaded from cache and added to items.
     */
    private shouldSkipIndexing(filePath: string): boolean {
        let currentHash = this.fileHashes.get(filePath);

        // Calculate hash if missing (blocking in main thread here is risky for large files,
        // but we assume hashing is fast or was pre-calculated in populateFileHashes)
        if (!currentHash && !this.indexing) {
            try {
                const content = fs.readFileSync(filePath);
                currentHash = crypto.createHash('sha256').update(content).digest('hex');
                this.fileHashes.set(filePath, currentHash);
            } catch {
                return false;
            }
        }

        const cached = this.persistence.get(filePath);
        if (cached && currentHash && cached.hash === currentHash) {
            this.fireItemsAdded(cached.symbols);
            return true;
        }

        // If mtime matches and we have a cache (fallback if hash missing)
        if (cached && !currentHash) {
            try {
                const stats = fs.statSync(filePath);
                if (Number(cached.mtime) === Number(stats.mtime)) {
                    this.fireItemsAdded(cached.symbols);
                    return true;
                }
            } catch {
                return false;
            }
        }

        return false;
    }

    /**
     * Fallback: Index files in main thread (original logic)
     */
    private async runFileIndexingFallback(
        fileItems: SearchableItem[],
        progressCallback?: (message: string, increment?: number) => void,
    ): Promise<void> {
        const totalFiles = fileItems.length;
        const CONCURRENCY = 50;
        let processed = 0;
        let activeWorkers = 0;
        let currentIndex = 0;
        let logged100 = false;
        let nextReportingPercentage = 0;

        return new Promise((resolve) => {
            const startNextWorker = async () => {
                if (currentIndex >= totalFiles) {
                    if (activeWorkers === 0) {
                        resolve();
                    }
                    return;
                }

                const fileItem = fileItems[currentIndex++];
                activeWorkers++;

                await this.indexOneFile(fileItem);

                processed++;
                activeWorkers--;

                if (processed % 100 === 0 || (processed === totalFiles && !logged100)) {
                    if (processed === totalFiles) {
                        logged100 = true;
                    }
                    this.log(
                        `Extraction progress: ${processed}/${totalFiles} files (${Math.round((processed / totalFiles) * 100)}%)`,
                    );
                }

                if (progressCallback) {
                    const percentage = (processed / totalFiles) * 100;
                    if (percentage >= nextReportingPercentage || processed === totalFiles) {
                        const fileName = path.basename(fileItem.filePath);
                        progressCallback(`Indexing ${fileName} (${processed}/${totalFiles})`, percentage);
                        nextReportingPercentage = percentage + 5;
                    }
                }

                startNextWorker();
            };

            for (let i = 0; i < Math.min(CONCURRENCY, totalFiles); i++) {
                startNextWorker();
            }
        });
    }

    /**
     * Index a single file and handle errors
     */
    private async indexOneFile(fileItem: SearchableItem): Promise<void> {
        try {
            await this.indexFileSymbols(fileItem.filePath);
        } catch (error) {
            // Fail silently but log for debug
            console.debug(`Indexing failed for ${fileItem.filePath}:`, error);
        }
    }

    /**
     * Process symbols from workspace provider
     */
    private processWorkspaceSymbols(symbols: import('./indexer-interfaces').LeanSymbolInformation[]): void {
        const batch: SearchableItem[] = [];
        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (!itemType) {
                continue;
            }

            const id = `symbol:${symbol.location.uri}:${symbol.name}:${symbol.location.range.start.line}`;
            // Duplication check removed as we don't hold state.

            batch.push({
                id,
                name: symbol.name,
                type: itemType,
                filePath: symbol.location.uri,
                relativeFilePath: this.env.asRelativePath(symbol.location.uri),
                line: symbol.location.range.start.line,
                column: symbol.location.range.start.character,
                containerName: symbol.containerName,
                fullName: symbol.containerName ? `${symbol.containerName}.${symbol.name}` : symbol.name,
            });
        }
        this.fireItemsAdded(batch);
    }

    /**
     * Index symbols from a single file with caching
     */
    private async indexFileSymbols(filePath: string): Promise<void> {
        let currentHash = this.fileHashes.get(filePath);

        // If no hash in memory, and this is an incremental update, calculate it
        if (!currentHash && !this.indexing) {
            currentHash = await this.calculateSingleFileHash(filePath);
            if (currentHash) {
                this.fileHashes.set(filePath, currentHash);
            }
        }

        const cached = this.persistence.get(filePath);
        if (cached && currentHash && cached.hash === currentHash) {
            this.fireItemsAdded(cached.symbols);
            return;
        }

        const stats = await fs.promises.stat(filePath);
        const mtime = Number(stats.mtime);

        if (cached && !currentHash && Number(cached.mtime) === mtime) {
            this.fireItemsAdded(cached.symbols);
            return;
        }

        try {
            const relPath = this.intern(this.env.asRelativePath(filePath));
            if (!this.indexing) {
                this.log(`Parsing file: ${relPath} ...`);
            }
            const symbolsFound = await this.performSymbolExtraction(filePath);

            if (symbolsFound.length > 0) {
                this.persistence.set(filePath, { mtime, hash: currentHash, symbols: symbolsFound });
                const processed = symbolsFound.map((s) => ({ ...s, relativeFilePath: relPath }));
                this.fireItemsAdded(processed);
            }
        } catch (error) {
            this.log(`Error indexing ${filePath}: ${error}`);
        }
    }

    private async calculateSingleFileHash(filePath: string): Promise<string | undefined> {
        try {
            const content = await fs.promises.readFile(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
        } catch {
            return undefined;
        }
    }

    /**
     * Core logic to extract symbols from a file
     */
    /**
     * Core logic to extract symbols from a file
     */
    private async performSymbolExtraction(filePath: string): Promise<SearchableItem[]> {
        const relPath = this.intern(this.env.asRelativePath(filePath));
        const internedFilePath = this.intern(filePath);

        // 1. Try Tree-sitter first (Turbo Path)
        try {
            const treeSitterItems = await this.treeSitter.parseFile(filePath);

            if (treeSitterItems.length > 0) {
                return treeSitterItems.map((item) => ({
                    ...item,
                    filePath: internedFilePath,
                    relativeFilePath: relPath,
                    name: this.intern(item.name),
                    fullName: item.fullName ? this.intern(item.fullName) : undefined,
                    containerName: item.containerName ? this.intern(item.containerName) : undefined,
                }));
            }
        } catch (e) {
            if (!this.indexing) {
                this.log(`Tree-sitter extraction failed for ${relPath}: ${e}`);
            }
        }

        // 2. Fallback to Environement symbol provider (e.g. VS Code's provider)
        if (this.env.executeDocumentSymbolProvider) {
            if (!this.indexing) {
                this.log(`Falling back to environment symbol provider for ${relPath}...`);
            }
            try {
                const symbols = await this.env.executeDocumentSymbolProvider(filePath);
                if (symbols && symbols.length > 0) {
                    const localItems: SearchableItem[] = [];
                    this.processSymbols(symbols, internedFilePath, relPath, localItems);
                    return localItems;
                }
            } catch (error) {
                this.log(`Environment symbol provider failed for ${relPath}: ${error}`);
            }
        }

        return [];
    }

    /**
     * Ensure extracted symbols are added to the main list
     * (Deprecated: Logic moved to event firing)
     */
    // private ensureSymbolsInItems(symbols: SearchableItem[], filePath: string): void { ... }

    /**
     * Get git hashes for files (Fast Cache Key)
     */
    private async populateFileHashes(): Promise<void> {
        this.fileHashes.clear();
        const workspaceFolders = this.env.getWorkspaceFolders();
        if (workspaceFolders.length === 0) {
            return;
        }

        for (const folderPath of workspaceFolders) {
            try {
                const output = await this.execGit(['ls-files', '--stage'], folderPath);

                const lines = output.split('\n');
                for (const line of lines) {
                    // Format: <mode> SP <object> SP <stage> TAB <file>
                    const match = line.match(/^(\d+) ([a-f0-9]+) (\d+)\t(.*)$/);
                    if (match) {
                        const hash = match[2];
                        const relPath = match[4];
                        const fullPath = path.join(folderPath, relPath);
                        this.fileHashes.set(fullPath, hash);
                    }
                }
            } catch (error) {
                // Git failed or not a repo, skip hashing
                console.debug(`Git hash population failed for ${folderPath}:`, error);
            }
        }
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
    }
}
