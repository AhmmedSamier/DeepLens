import * as cp from 'child_process';
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
    private indexing: boolean = false;
    private config: Config;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private treeSitter: import('./core/tree-sitter-parser').TreeSitterParser;
    private persistence: IndexPersistence;
    private fileHashes: Map<string, string> = new Map();

    constructor(
        config: Config,
        treeSitter: import('./core/tree-sitter-parser').TreeSitterParser,
        persistence: IndexPersistence,
    ) {
        this.config = config;
        this.treeSitter = treeSitter;
        this.persistence = persistence;
    }

    /**
     * Start indexing the workspace
     */
    async indexWorkspace(progressCallback?: (message: string, increment?: number) => void): Promise<void> {
        if (this.indexing) {
            return;
        }

        this.indexing = true;
        this.items = [];

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                return;
            }

            // Load cache
            await this.persistence.load();

            // Try to get git hashes first (TURBO: used for metadata-free indexing)
            progressCallback?.('Analyzing repository structure...', 0);
            await this.populateFileHashes();

            // Index files (PRO: now parallelized)
            progressCallback?.('Scanning files...', 10);
            await this.indexFiles();

            // Index symbols from files
            await this.indexSymbols(progressCallback);

            // Save cache
            await this.persistence.save();

            // Set up file watchers for incremental updates
            this.setupFileWatchers();
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
            } catch (e) {
                // Not a git repo or git not installed
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
    private async scanWorkspaceSymbols(progressCallback?: (message: string, increment?: number) => void): Promise<void> {
        progressCallback?.('Fast-scanning workspace symbols...', 5);
        try {
            const workspaceSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                '',
            );

            if (workspaceSymbols && workspaceSymbols.length > 0) {
                this.processWorkspaceSymbols(workspaceSymbols);
            }
        } catch (e) {
            console.log('Workspace symbol pass failed, moving to file-by-file...');
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

                if (processed % 20 === 0 || processed === totalFiles) {
                    const fileName = path.basename(fileItem.filePath);
                    progressCallback?.(`Indexing ${fileName} (${processed}/${totalFiles})`, (20 / totalFiles) * 70);
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
            // Fail silently
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
        const currentHash = this.fileHashes.get(filePath);

        // ULTRA-FAST CACHE CHECK: Use hash if available (zero disk I/O)
        const cached = this.persistence.get(filePath);
        if (cached && currentHash && cached.hash === currentHash) {
            this.items.push(...cached.symbols);
            return;
        }

        // FALLBACK: Use mtime if no hash or hash mismatch
        const stats = await vscode.workspace.fs.stat(fileUri);
        const mtime = stats.mtime;

        if (cached && !currentHash && cached.mtime === mtime) {
            this.items.push(...cached.symbols);
            return;
        }

        try {
            // Try to find symbols using either Tree-sitter or VS Code providers
            const symbolsFound = await this.performSymbolExtraction(fileUri);

            if (symbolsFound.length > 0) {
                // Update cache
                this.persistence.set(filePath, { mtime, hash: currentHash, symbols: symbolsFound });

                // Add to main items list - thread-safe merge
                this.items.push(...symbolsFound);
            }
        } catch (error) {
            console.log(`Could not extract symbols from ${filePath}: ${error}`);
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

        // 1. Try Tree-sitter first (Turbo Path)
        const treeSitterItems = await this.treeSitter.parseFile(fileUri);
        if (treeSitterItems.length > 0) {
            return treeSitterItems;
        }

        // 2. Fallback to VS Code provider
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
            this.processSymbols(symbols, filePath, localItems);
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
                    const match = line.match(/^\d+\s+([a-f0-9]+)\s+\d+\s+(.+)$/);
                    if (match) {
                        const hash = match[1];
                        const relPath = match[2];
                        const fullPath = path.join(folder.uri.fsPath, relPath);
                        this.fileHashes.set(fullPath, hash);
                    }
                }
            } catch (e) {
                // Git failed or not a repo, skip hashing
            }
        }
    }

    /**
     * Process symbols recursively
     */
    private processSymbols(
        symbols: vscode.DocumentSymbol[],
        filePath: string,
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
                this.processSymbols(symbol.children, filePath, collector, newContainerName);
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
    }

    /**
     * Handle file changed
     */
    private async handleFileChanged(uri: vscode.Uri): Promise<void> {
        // Remove old symbols for this file
        this.items = this.items.filter((item) => item.filePath !== uri.fsPath || item.type === SearchItemType.FILE);

        // Re-index symbols
        await this.indexFileSymbols(uri);
    }

    /**
     * Handle file deleted
     */
    private handleFileDeleted(uri: vscode.Uri): void {
        // Remove all items for this file
        this.items = this.items.filter((item) => item.filePath !== uri.fsPath);
    }

    /**
     * Incrementally sync the index based on git changes (e.g., branch switch)
     */
    async syncGitDelta(): Promise<void> {
        if (this.indexing) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        this.indexing = true;
        try {
            for (const folder of workspaceFolders) {
                await this.syncFolderDelta(folder);
            }

            // Sync hashes and persistence
            await this.populateFileHashes();
            await this.persistence.save();
        } finally {
            this.indexing = false;
        }
    }

    /**
     * Sync changes for a specific workspace folder
     */
    private async syncFolderDelta(folder: vscode.WorkspaceFolder): Promise<void> {
        const folderPath = folder.uri.fsPath;
        try {
            // Get changes between previous HEAD and current HEAD
            const output = cp.execSync('git diff --name-only HEAD@{1} HEAD', {
                cwd: folderPath,
                encoding: 'utf8',
            });

            const relativePaths = output.split('\n').filter((p) => p.trim() !== '');
            if (relativePaths.length === 0) {
                return;
            }

            console.log(`Git delta sync: Processing ${relativePaths.length} changes in ${folder.name}`);

            for (const relPath of relativePaths) {
                await this.syncFileDelta(folderPath, relPath);
            }
        } catch (e) {
            console.log('Git delta sync skipped or failed for folder:', folder.name);
        }
    }

    /**
     * Sync a single file's delta change
     */
    private async syncFileDelta(folderPath: string, relPath: string): Promise<void> {
        const fullPath = path.join(folderPath, relPath);
        const uri = vscode.Uri.file(fullPath);

        if (fs.existsSync(fullPath)) {
            const ext = path.extname(fullPath).toLowerCase().slice(1);
            if (this.config.getFileExtensions().includes(ext)) {
                // If already in items as FILE, update symbols; else treat as new
                const alreadyKnown = this.items.some((i) => i.filePath === fullPath && i.type === SearchItemType.FILE);
                if (alreadyKnown) {
                    await this.handleFileChanged(uri);
                } else {
                    await this.handleFileCreated(uri);
                }
            }
        } else {
            this.handleFileDeleted(uri);
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.fileWatcher?.dispose();
    }
}
