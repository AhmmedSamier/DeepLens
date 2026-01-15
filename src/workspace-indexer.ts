import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Config } from './config';
import { IndexPersistence } from './core/index-persistence';
import { SearchableItem, SearchItemType } from './core/types';

/**
 * Workspace indexer that scans files and extracts symbols
 */
const EXECUTE_DOCUMENT_SYMBOL_PROVIDER = 'vscode.executeDocumentSymbolProvider';

export class WorkspaceIndexer {
    private items: SearchableItem[] = [];
    private onDidChangeItemsEmitter = new vscode.EventEmitter<SearchableItem[]>();
    public readonly onDidChangeItems = this.onDidChangeItemsEmitter.event;

    private indexing: boolean = false;
    private watchersActive: boolean = true;
    private watcherCooldownTimer: NodeJS.Timeout | undefined;
    private config: Config;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private treeSitter: import('./core/tree-sitter-parser').TreeSitterParser;
    private persistence: IndexPersistence;
    private fileHashes: Map<string, string> = new Map();
    private logger: vscode.OutputChannel;

    constructor(
        config: Config,
        treeSitter: import('./core/tree-sitter-parser').TreeSitterParser,
        persistence: IndexPersistence,
    ) {
        this.config = config;
        this.treeSitter = treeSitter;
        this.persistence = persistence;
        this.logger = vscode.window.createOutputChannel('DeepLens');
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
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
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
        const includePattern = `**/*.{${fileExtensions.join(',')}}`;

        // VS Code's findFiles automatically respects files.exclude and .gitignore
        const excludePattern = `{${excludePatterns.join(',')}}`;
        const files = await vscode.workspace.findFiles(includePattern, excludePattern);

        await this.processFileList(files);
    }

    /**
     * List files using git (much faster than walking disk)
     */
    private async listGitFiles(extensions: string[]): Promise<vscode.Uri[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return [];
        }

        const results: vscode.Uri[] = [];
        for (const folder of workspaceFolders) {
            try {
                // Get both tracked and untracked (but not ignored) files
                const output = cp
                    .execSync('git ls-files --cached --others --exclude-standard', {
                        cwd: folder.uri.fsPath,
                        maxBuffer: 10 * 1024 * 1024,
                    })
                    .toString();

                const lines = output.split('\n');
                const extSet = new Set(extensions.map((e) => `.${e.toLowerCase()}`));

                for (const line of lines) {
                    if (!line || line.trim() === '') {
                        continue;
                    }

                    const fullPath = path.join(folder.uri.fsPath, line);
                    const ext = path.extname(fullPath).toLowerCase();

                    if (extSet.has(ext)) {
                        results.push(vscode.Uri.file(fullPath));
                    }
                }
            } catch (error) {
                // Not a git repo or git not installed
                console.debug(`Git file listing failed for ${folder.uri.fsPath}:`, error);
            }
        }
        return results;
    }

    /**
     * Process a list of file URIs into searchable items in parallel
     */
    private async processFileList(files: vscode.Uri[]): Promise<void> {
        const CONCURRENCY = 100; // Higher concurrency for metadata checks
        const chunks: vscode.Uri[][] = [];

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            chunks.push(files.slice(i, i + CONCURRENCY));
        }

        for (const chunk of chunks) {
            await Promise.all(
                chunk.map(async (file) => {
                    // Skip C# auto-generated files in parallel
                    if (file.fsPath.endsWith('.cs')) {
                        const isAutoGenerated = await this.isAutoGeneratedFile(file);
                        if (isAutoGenerated) {
                            return;
                        }
                    }

                    const fileName = path.basename(file.fsPath);
                    const relativePath = vscode.workspace.asRelativePath(file.fsPath);

                    this.items.push({
                        id: `file:${file.fsPath}`,
                        name: fileName,
                        type: SearchItemType.FILE,
                        filePath: file.fsPath,
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
     * Optimized to avoid opening a full VS Code document
     */
    private async isAutoGeneratedFile(fileUri: vscode.Uri): Promise<boolean> {
        try {
            // Read only first 1KB to check for marker - much faster than openTextDocument
            const buffer = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(buffer.slice(0, 1024)).toString('utf8');

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
            console.debug(`Auto-generated check failed for ${fileUri.fsPath}:`, error);
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
        try {
            const workspaceSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                '',
            );

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
            await this.indexFileSymbols(vscode.Uri.file(fileItem.filePath));
        } catch (error) {
            // Fail silently but log for debug
            console.debug(`Indexing failed for ${fileItem.filePath}:`, error);
        }
    }

    /**
     * Process symbols from workspace provider
     */
    private processWorkspaceSymbols(symbols: vscode.SymbolInformation[]): void {
        for (const symbol of symbols) {
            const itemType = this.mapSymbolKindToItemType(symbol.kind);
            if (!itemType) {
                continue;
            }

            const id = `symbol:${symbol.location.uri.fsPath}:${symbol.name}:${symbol.location.range.start.line}`;
            if (this.items.some((i) => i.id === id)) {
                continue;
            }

            this.items.push({
                id,
                name: symbol.name,
                type: itemType,
                filePath: symbol.location.uri.fsPath,
                relativeFilePath: vscode.workspace.asRelativePath(symbol.location.uri.fsPath),
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
    private async indexFileSymbols(fileUri: vscode.Uri): Promise<void> {
        const filePath = fileUri.fsPath;
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

        const stats = await vscode.workspace.fs.stat(fileUri);
        const mtime = Number(stats.mtime);

        if (cached && !currentHash && Number(cached.mtime) === mtime) {
            this.items.push(...cached.symbols);
            return;
        }

        try {
            const relPath = vscode.workspace.asRelativePath(fileUri);
            if (!this.indexing) {
                this.log(`Parsing file: ${relPath} ...`);
            }
            const symbolsFound = await this.performSymbolExtraction(fileUri);

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
    private async performSymbolExtraction(fileUri: vscode.Uri): Promise<SearchableItem[]> {
        const filePath = fileUri.fsPath;

        const relPath = vscode.workspace.asRelativePath(fileUri);

        // 1. Try Tree-sitter first (Turbo Path)
        try {
            const treeSitterItems = await this.treeSitter.parseFile(fileUri);

            if (treeSitterItems.length > 0) {
                return treeSitterItems.map((item) => ({ ...item, relativeFilePath: relPath }));
            }
        } catch (e) {
            if (!this.indexing) {
                this.log(`Tree-sitter extraction failed for ${relPath}: ${e}`);
            }
        }

        // 2. Fallback to VS Code provider
        if (!this.indexing) {
            this.log(`Falling back to VS Code symbol provider for ${relPath}...`);
        }
        let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            EXECUTE_DOCUMENT_SYMBOL_PROVIDER,
            fileUri,
        );

        // 3. Last ditch effort: open document to trigger LSP
        if (!symbols || symbols.length === 0) {
            await vscode.workspace.openTextDocument(fileUri);
            await new Promise((resolve) => setTimeout(resolve, 200));
            symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                EXECUTE_DOCUMENT_SYMBOL_PROVIDER,
                fileUri,
            );
        }

        if (symbols && symbols.length > 0) {
            const localItems: SearchableItem[] = [];
            this.processSymbols(symbols, filePath, vscode.workspace.asRelativePath(fileUri), localItems);
            return localItems;
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
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            try {
                const output = cp
                    .execSync('git ls-files --stage', {
                        cwd: folder.uri.fsPath,
                        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
                    })
                    .toString();

                const lines = output.split('\n');
                for (const line of lines) {
                    // Format: <mode> SP <object> SP <stage> TAB <file>
                    const match = line.match(/^(\d+) ([a-f0-9]+) (\d+)\t(.*)$/);
                    if (match) {
                        const hash = match[2];
                        const relPath = match[4];
                        const fullPath = path.join(folder.uri.fsPath, relPath);
                        this.fileHashes.set(fullPath, hash);
                    }
                }
            } catch (error) {
                // Git failed or not a repo, skip hashing
                console.debug(`Git hash population failed for ${folder.uri.fsPath}:`, error);
            }
        }
    }

    /**
     * Process symbols recursively
     */
    private processSymbols(
        symbols: vscode.DocumentSymbol[],
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
     * Map VS Code SymbolKind to our SearchItemType
     */
    private mapSymbolKindToItemType(kind: vscode.SymbolKind): SearchItemType | null {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return SearchItemType.CLASS;
            case vscode.SymbolKind.Interface:
                return SearchItemType.INTERFACE;
            case vscode.SymbolKind.Enum:
                return SearchItemType.ENUM;
            case vscode.SymbolKind.Function:
                return SearchItemType.FUNCTION;
            case vscode.SymbolKind.Method:
                return SearchItemType.METHOD;
            case vscode.SymbolKind.Property:
            case vscode.SymbolKind.Field:
                return SearchItemType.PROPERTY;
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Constant:
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
        const fileExtensions = this.config.getFileExtensions();
        const pattern = `**/*.{${fileExtensions.join(',')}}`;

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        // Handle file creation
        this.fileWatcher.onDidCreate((uri) => {
            this.handleFileCreated(uri);
        });

        // Handle file changes
        this.fileWatcher.onDidChange((uri) => {
            this.handleFileChanged(uri);
        });

        // Handle file deletion
        this.fileWatcher.onDidDelete((uri) => {
            this.handleFileDeleted(uri);
        });
    }

    /**
     * Handle file created
     */
    private async handleFileCreated(uri: vscode.Uri): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip during full re-index or cooldown
        }

        const fileName = path.basename(uri.fsPath);
        const relativePath = vscode.workspace.asRelativePath(uri.fsPath);

        // Add file item
        this.items.push({
            id: `file:${uri.fsPath}`,
            name: fileName,
            type: SearchItemType.FILE,
            filePath: uri.fsPath,
            detail: relativePath,
            fullName: relativePath,
        });

        // Index symbols
        await this.indexFileSymbols(uri);

        this.log(`Indexed new file: ${relativePath}`);

        // Notify that items have changed
        this.onDidChangeItemsEmitter.fire(this.items);
    }

    /**
     * Handle file changed
     */
    private async handleFileChanged(uri: vscode.Uri): Promise<void> {
        if (this.indexing || !this.watchersActive) {
            return; // Skip individual updates during full re-index or cooldown
        }

        // Remove old symbols for this file
        this.items = this.items.filter((item) => item.filePath !== uri.fsPath || item.type === SearchItemType.FILE);

        // Re-index symbols (it will check cache internally)
        await this.indexFileSymbols(uri);

        // Notify that items have changed
        this.onDidChangeItemsEmitter.fire(this.items);
    }

    /**
     * Handle file deleted
     */
    private handleFileDeleted(uri: vscode.Uri): void {
        // Remove all items for this file
        this.items = this.items.filter((item) => item.filePath !== uri.fsPath);

        // Notify that items have changed
        this.onDidChangeItemsEmitter.fire(this.items);
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
        this.logger.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
        console.log(`[Indexer] ${message}`);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.fileWatcher?.dispose();
        this.onDidChangeItemsEmitter.dispose();
    }
}
