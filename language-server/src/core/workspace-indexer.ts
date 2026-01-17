import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { IndexPersistence } from './index-persistence';
import { SearchableItem, SearchItemType } from './types';
import { IndexerEnvironment } from './indexer-interfaces';

/**
 * Workspace indexer that scans files and extracts symbols
 */
export class WorkspaceIndexer {
    private items: SearchableItem[] = [];
    private onDidChangeItemsListeners: ((items: SearchableItem[]) => void)[] = [];

    private indexing: boolean = false;
    private watchersActive: boolean = true;
    private watcherCooldownTimer: NodeJS.Timeout | undefined;
    private config: Config;
    private fileWatcher: { dispose(): void } | undefined;
    private treeSitter: import('./tree-sitter-parser').TreeSitterParser;
    private persistence: IndexPersistence;
    private fileHashes: Map<string, string> = new Map();
    private env: IndexerEnvironment;

    constructor(
        config: Config,
        treeSitter: import('./tree-sitter-parser').TreeSitterParser,
        persistence: IndexPersistence,
        env: IndexerEnvironment
    ) {
        this.config = config;
        this.treeSitter = treeSitter;
        this.persistence = persistence;
        this.env = env;
    }

    public onDidChangeItems(listener: (items: SearchableItem[]) => void) {
        this.onDidChangeItemsListeners.push(listener);
        return {
            dispose: () => {
                this.onDidChangeItemsListeners = this.onDidChangeItemsListeners.filter(l => l !== listener);
            }
        };
    }

    private fireDidChangeItems(items: SearchableItem[]) {
        for (const listener of this.onDidChangeItemsListeners) {
            listener(items);
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
        this.items = [];

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
            await this.indexFiles();

            // Index symbols from files
            this.log(`Step 3/5: Extracting symbols from ${this.items.length} files...`);
            let reportedStepProgress = 0;
            await this.indexSymbols((message, totalPercentage) => {
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

            // Log summary
            const endpointCount = this.items.filter((i) => i.type === SearchItemType.ENDPOINT).length;
            this.log(`Final Index Summary: ${this.items.length} total items, ${endpointCount} endpoints.`);

            // Notify listeners that items have updated
            this.fireDidChangeItems(this.items);
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Get all indexed items
     */
    getItems(): SearchableItem[] {
        return this.items;
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
    private async indexFiles(): Promise<void> {
        const fileExtensions = this.config.getFileExtensions();

        // TURBO PATH: Try to use git ls-files for instant listing if it's a git repo
        const gitFiles = await this.listGitFiles(fileExtensions);
        if (gitFiles.length > 0) {
            await this.processFileList(gitFiles);
            return;
        }

        // STANDARD FALLBACK
        const excludePatterns = this.config.getExcludePatterns();
        const includePattern = `**/*`;

        // LSP client or VS Code provides the implementation
        const excludePattern = `{${excludePatterns.join(',')}}`;
        const files = await this.env.findFiles(includePattern, excludePattern);

        await this.processFileList(files);
    }

    /**
     * List files using git (much faster than walking disk)
     */
    private async listGitFiles(extensions: string[]): Promise<string[]> {
        const workspaceFolders = this.env.getWorkspaceFolders();
        if (workspaceFolders.length === 0) {
            return [];
        }

        const results: string[] = [];
        for (const folderPath of workspaceFolders) {
            try {
                // Get both tracked and untracked (but not ignored) files
                const output = await new Promise<string>((resolve, reject) => {
                    cp.exec(
                        'git ls-files --cached --others --exclude-standard',
                        {
                            cwd: folderPath,
                            maxBuffer: 10 * 1024 * 1024,
                        },
                        (error, stdout) => {
                            if (error) reject(error);
                            else resolve(stdout);
                        }
                    );
                });

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
    private async processFileList(files: string[]): Promise<void> {
        const CONCURRENCY = 100; // Higher concurrency for metadata checks
        const chunks: string[][] = [];

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            chunks.push(files.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
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
                    const relativePath = this.env.asRelativePath(filePath);

                    this.items.push({
                        id: `file:${filePath}`,
                        name: fileName,
                        type: SearchItemType.FILE,
                        filePath: filePath,
                        relativeFilePath: relativePath,
                        detail: relativePath,
                        fullName: relativePath,
                    });
                }),
            );
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
    private async indexSymbols(progressCallback?: (message: string, increment?: number) => void): Promise<void> {
        const fileItems = this.items.filter((item) => item.type === SearchItemType.FILE);
        const totalFiles = fileItems.length;

        if (totalFiles === 0) {
            return;
        }

        // HIGH-PERFORMANCE PASS 1: Try workspace-wide symbol extraction
        await this.scanWorkspaceSymbols(progressCallback);

        // HIGH-PERFORMANCE PASS 2: Sliding Window Concurrent Pool
        await this.runFileIndexingPool(fileItems, progressCallback);
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
     * Run concurrent file-by-file indexing pool
     */
    private async runFileIndexingPool(
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

                // Log granular progress for the output channel every 100 files
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
                    const fileName = path.basename(fileItem.filePath);
                    // Only report to UI every 5% to avoid overwhelming the extension host
                    if (percentage >= nextReportingPercentage || processed === totalFiles) {
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
        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (!itemType) {
                continue;
            }

            const id = `symbol:${symbol.location.uri}:${symbol.name}:${symbol.location.range.start.line}`;
            if (this.items.some((i) => i.id === id)) {
                continue;
            }

            this.items.push({
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
            this.items.push(...cached.symbols);
            return;
        }

        const stats = await fs.promises.stat(filePath);
        const mtime = Number(stats.mtime);

        if (cached && !currentHash && Number(cached.mtime) === mtime) {
            this.items.push(...cached.symbols);
            return;
        }

        try {
            const relPath = this.env.asRelativePath(filePath);
            if (!this.indexing) {
                this.log(`Parsing file: ${relPath} ...`);
            }
            const symbolsFound = await this.performSymbolExtraction(filePath);

            if (symbolsFound.length > 0) {
                this.persistence.set(filePath, { mtime, hash: currentHash, symbols: symbolsFound });
                this.items.push(...symbolsFound.map((s) => ({ ...s, relativeFilePath: relPath })));
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
     * Attempt to load symbols from persistent cache
     */
    private tryLoadFromCache(filePath: string, mtime: number, hash?: string): boolean {
        const cached = this.persistence.get(filePath);
        if (cached && (hash ? cached.hash === hash : cached.mtime === mtime)) {
            this.items.push(...cached.symbols);
            return true;
        }
        return false;
    }

    /**
     * Core logic to extract symbols from a file
     */
    /**
     * Core logic to extract symbols from a file
     */
    private async performSymbolExtraction(filePath: string): Promise<SearchableItem[]> {
        const relPath = this.env.asRelativePath(filePath);

        // 1. Try Tree-sitter first (Turbo Path)
        try {
            const treeSitterItems = await this.treeSitter.parseFile(filePath);

            if (treeSitterItems.length > 0) {
                return treeSitterItems.map((item) => ({ ...item, relativeFilePath: relPath }));
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
                    this.processSymbols(symbols, filePath, relPath, localItems);
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
     */
    private ensureSymbolsInItems(symbols: SearchableItem[], filePath: string): void {
        const alreadyInItems = this.items.some((i) => i.filePath === filePath && i.type !== SearchItemType.FILE);
        if (!alreadyInItems) {
            this.items.push(...symbols);
        }
    }

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
                const output = await new Promise<string>((resolve, reject) => {
                    cp.exec(
                        'git ls-files --stage',
                        {
                            cwd: folderPath,
                            maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
                        },
                        (error, stdout) => {
                            if (error) reject(error);
                            else resolve(stdout);
                        }
                    );
                });

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
        filePath: string,
        relativeFilePath: string,
        collector: SearchableItem[],
        containerName?: string,
    ): void {
        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (itemType) {
                const fullName = containerName ? `${containerName}.${symbol.name}` : symbol.name;

                collector.push({
                    id: `symbol:${filePath}:${fullName}:${symbol.range.start.line}`,
                    name: symbol.name,
                    type: itemType,
                    filePath,
                    relativeFilePath,
                    line: symbol.range.start.line,
                    column: symbol.range.start.character,
                    containerName,
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
     * Handle file created
     */
    private async handleFileCreated(filePath: string): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip during full re-index or cooldown
        }

        const fileName = path.basename(filePath);
        const relativePath = this.env.asRelativePath(filePath);

        // Add file item
        this.items.push({
            id: `file:${filePath}`,
            name: fileName,
            type: SearchItemType.FILE,
            filePath: filePath,
            detail: relativePath,
            fullName: relativePath,
        });

        // Index symbols
        await this.indexFileSymbols(filePath);

        this.log(`Indexed new file: ${relativePath}`);

        // Notify that items have changed
        this.fireDidChangeItems(this.items);
    }

    /**
     * Handle file changed
     */
    private async handleFileChanged(filePath: string): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip individual updates during full re-index or cooldown
        }

        // Remove old symbols for this file
        this.items = this.items.filter((item) => item.filePath !== filePath || item.type === SearchItemType.FILE);

        // Re-index symbols (it will check cache internally)
        await this.indexFileSymbols(filePath);

        // Notify that items have changed
        this.fireDidChangeItems(this.items);
    }

    /**
     * Handle file deleted
     */
    private handleFileDeleted(filePath: string): void {
        // Remove all items for this file
        this.items = this.items.filter((item) => item.filePath !== filePath);

        // Notify that items have changed
        this.fireDidChangeItems(this.items);
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
        console.log(`[Indexer] ${message}`);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.fileWatcher?.dispose();
    }
}
