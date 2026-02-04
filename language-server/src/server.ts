import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    createConnection,
    DidChangeConfigurationNotification,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    RequestType,
    RequestType0,
    SymbolKind,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver/node';

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ActivityTracker } from './core/activity-tracker';
import { Config } from './core/config';
import { FileProvider } from './core/providers/file-provider';
import { RecentProvider } from './core/providers/recent-provider';
import { SymbolProvider } from './core/providers/symbol-provider';
import { SearchEngine } from './core/search-engine';
import { TreeSitterParser } from './core/tree-sitter-parser';
import { IndexStats, SearchItemType, SearchOptions, SearchResult, SearchScope } from './core/types';
import { CancellationError, WorkspaceIndexer } from './core/workspace-indexer';
import { LspIndexerEnvironment } from './indexer-client';

/**
 * Robustly convert URI to file path handling Windows drive letters and UNC paths
 */
function uriToPath(uri: string): string {
    if (uri.startsWith('file:///')) {
        const decoded = decodeURIComponent(uri);
        const afterSlash = decoded.slice(7); // /c:/foo or /usr/bin

        // Windows drive letter check (e.g., /c: or /C:)
        if (/^\/[a-zA-Z]:/.test(afterSlash)) {
            // Strip leading slash for Windows path: c:/foo
            return path.normalize(afterSlash.slice(1));
        }
        // Unix-like absolute path
        return path.normalize(afterSlash);
    }

    if (uri.startsWith('file://')) {
        return path.normalize(decodeURIComponent(uri.slice(7)));
    }

    return uri;
}

// Custom requests
export const BurstSearchRequest = new RequestType<SearchOptions, SearchResult[], void>('deeplens/burstSearch');
export const ResolveItemsRequest = new RequestType<{ itemIds: string[] }, SearchResult[], void>(
    'deeplens/resolveItems',
);
export const GetRecentItemsRequest = new RequestType<{ count: number }, SearchResult[], void>(
    'deeplens/getRecentItems',
);
export const RecordActivityRequest = new RequestType<{ itemId: string }, void, void>('deeplens/recordActivity');
export const RebuildIndexRequest = new RequestType<{ force: boolean }, void, void>('deeplens/rebuildIndex');
export const ClearCacheRequest = new RequestType0<void, void>('deeplens/clearCache');
export const IndexStatsRequest = new RequestType0<IndexStats, void>('deeplens/indexStats');

// Create a connection for the server, using Node's stdin/stdout
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkDoneProgressCapability = false;

let searchEngine: SearchEngine;
let workspaceIndexer: WorkspaceIndexer;
let treeSitterParser: TreeSitterParser;
let config: Config;
let activityTracker: ActivityTracker;

let isInitialized = false;
let isShuttingDown = false;
let fileLogger: (msg: string) => void = () => {};

connection.onInitialize(async (params: InitializeParams) => {
    const capabilities = params.capabilities;

    hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
    hasWorkDoneProgressCapability = !!capabilities.window?.workDoneProgress;

    // Monitor parent process
    if (params.processId) {
        setInterval(() => {
            try {
                // kill(pid, 0) checks if process exists without killing it
                process.kill(params.processId, 0);
            } catch {
                // Parent process is gone
                process.exit(1);
            }
        }, 5000);
    }

    // Get storage path from initialization options or fall back to a temp dir
    const storagePath = params.initializationOptions?.storagePath || path.join(process.cwd(), '.deeplens');
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    const logFile = path.join(storagePath, 'debug.log');
    fileLogger = (msg: string) => {
        const timestamp = new Date().toISOString();
        try {
            fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
        } catch {
            // Ignore logging errors
        }
    };

    fileLogger('--- DeepLens Server Starting ---');
    fileLogger(`Storage Path: ${storagePath}`);
    fileLogger(`Node Version: ${process.version}`);
    fileLogger(`Platform: ${process.platform}`);

    // Resolve workspace folders
    let folders: string[] = [];
    if (params.workspaceFolders) {
        folders = params.workspaceFolders.map((f) => uriToPath(f.uri));
    } else if (params.rootUri) {
        folders = [uriToPath(params.rootUri)];
    } else if (params.rootPath) {
        folders = [params.rootPath];
    }

    // Initialize core components
    config = new Config();

    // extensionPath is needed for TreeSitter parsers to find WASM files
    const extensionPath = params.initializationOptions?.extensionPath || process.cwd();
    treeSitterParser = new TreeSitterParser(extensionPath, {
        appendLine: (msg) => connection.console.log(msg),
    });
    await treeSitterParser.init();

    const indexerEnv = new LspIndexerEnvironment(connection, folders);
    workspaceIndexer = new WorkspaceIndexer(config, treeSitterParser, indexerEnv, extensionPath);
    workspaceIndexer.warmup(); // Proactively boot workers

    activityTracker = new ActivityTracker(storagePath);
    searchEngine = new SearchEngine();
    searchEngine.setWorkspaceRoots(folders);

    // Register Providers
    searchEngine.registerProvider(new RecentProvider(activityTracker));
    searchEngine.registerProvider(new FileProvider(searchEngine));
    searchEngine.registerProvider(new SymbolProvider(searchEngine));

    searchEngine.setConfig(config);
    searchEngine.setExtensionPath(extensionPath);
    searchEngine.setLogger({
        log: (msg) => connection.console.log(msg),
        error: (msg) => connection.console.error(msg),
    });

    // Sync active files for prioritization
    const updateActiveFiles = () => {
        const openFiles = documents.all().map((doc) => uriToPath(doc.uri));
        searchEngine.setActiveFiles(openFiles);
    };

    documents.onDidOpen(updateActiveFiles);
    documents.onDidClose(updateActiveFiles);
    documents.listen(connection);

    // Wire up search engine to indexer
    workspaceIndexer.onItemsAdded((items) => searchEngine.addItems(items));
    workspaceIndexer.onItemsRemoved((filePath) => searchEngine.removeItemsByFile(filePath));

    if (config.isActivityTrackingEnabled()) {
        searchEngine.setActivityCallback(
            (itemId) => activityTracker.getActivityScore(itemId),
            config.getActivityWeight(),
        );
    }

    // Load initial configuration if possible
    if (hasConfigurationCapability) {
        connection.workspace
            .getConfiguration('deeplens')
            .then((settings) => {
                config.update(settings);
            })
            .catch((err) => {
                connection.console.error(`Failed to load configuration: ${err}`);
            });
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports workspace symbols.
            workspaceSymbolProvider: true,
        },
    };
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }

    // Initial indexing with progress
    runIndexingWithProgress().then(() => {
        isInitialized = true;
        connection.console.log('DeepLens index built successfully');
    });
});

connection.onDidChangeConfiguration(async () => {
    if (hasConfigurationCapability) {
        const settings = await connection.workspace.getConfiguration('deeplens');
        config.update(settings);
    }
});

let currentIndexingPromise: Promise<void> | undefined;

async function shutdownServer(exitCode?: number): Promise<void> {
    if (isShuttingDown) {
        if (exitCode !== undefined) {
            process.exit(exitCode);
        }
        return;
    }

    isShuttingDown = true;

    try {
        workspaceIndexer?.cancel();
        if (currentIndexingPromise) {
            try {
                await currentIndexingPromise;
            } catch {
                // Ignore errors from the cancelled process
            }
        }
        workspaceIndexer?.dispose();
        if (treeSitterParser && typeof (treeSitterParser as any).dispose === 'function') {
            (treeSitterParser as any).dispose();
        }
    } finally {
        if (activityTracker) {
            activityTracker.saveActivities();
        }
        connection.console.log('DeepLens Language Server shutting down');
        if (exitCode !== undefined) {
            process.exit(exitCode);
        }
    }
}

/**
 * Run indexing with progress reporting
 */
async function runIndexingWithProgress(): Promise<void> {
    if (isShuttingDown) {
        return;
    }
    // If indexing is already running, cancel it and wait for it to stop
    if (currentIndexingPromise) {
        workspaceIndexer.cancel();
        try {
            await currentIndexingPromise;
        } catch {
            // Ignore errors from the cancelled process
        }
    }

    const token = 'indexing-' + Date.now();

    if (isShuttingDown) {
        return;
    }

    // We need to wait a small bit for the client to be ready for requests immediately after initialized
    // but creating the progress token handles the handshake
    if (hasWorkDoneProgressCapability) {
        try {
            await connection.sendRequest('window/workDoneProgress/create', { token });
        } catch (e) {
            connection.console.error(`Failed to create progress token: ${e}`);
        }
    }

    const indexingTask = async () => {
        // Clear existing items to prevent duplicates on rebuild
        searchEngine.clear();

        try {
            const startTime = Date.now();
            let currentPercentage = 0;
            await workspaceIndexer.indexWorkspace((message, increment) => {
                if (increment) {
                    currentPercentage += increment;
                }
                // Cap at 99% until explicitly done
                const percentage = Math.min(99, Math.round(currentPercentage));
                if (!isShuttingDown) {
                    connection.sendNotification('deeplens/progress', { token, message, percentage });
                }
            });

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            if (!isShuttingDown) {
                connection.sendNotification('deeplens/progress', {
                    token,
                    message: `Done (${duration}s)`,
                    percentage: 100,
                });
            }
        } catch (error) {
            if (error instanceof CancellationError) {
                if (!isShuttingDown) {
                    connection.sendNotification('deeplens/progress', {
                        token,
                        message: 'Cancelled',
                        percentage: 100,
                    });
                }
                throw error;
            } else {
                connection.console.error(`Error during indexing: ${error}`);
                if (!isShuttingDown) {
                    connection.sendNotification('deeplens/progress', {
                        token,
                        message: 'Failed',
                        percentage: 100,
                    });
                }
            }
        }
    };

    const p = indexingTask();
    currentIndexingPromise = p;

    try {
        await p;
    } catch {
        // Ignore errors, they are handled inside indexingTask
    } finally {
        if (currentIndexingPromise === p) {
            currentIndexingPromise = undefined;
        }
    }
}

// Map SearchItemType to SymbolKind
function mapItemTypeToSymbolKind(type: SearchItemType): SymbolKind {
    switch (type) {
        case SearchItemType.FILE:
            return SymbolKind.File;
        case SearchItemType.CLASS:
            return SymbolKind.Class;
        case SearchItemType.INTERFACE:
            return SymbolKind.Interface;
        case SearchItemType.ENUM:
            return SymbolKind.Enum;
        case SearchItemType.FUNCTION:
            return SymbolKind.Function;
        case SearchItemType.METHOD:
            return SymbolKind.Method;
        case SearchItemType.PROPERTY:
            return SymbolKind.Property;
        case SearchItemType.VARIABLE:
            return SymbolKind.Variable;
        default:
            return SymbolKind.Object;
    }
}

// Implement workspace/symbol
connection.onWorkspaceSymbol(async (params) => {
    if (!isInitialized) return [];

    const results = await searchEngine.search({
        query: params.query,
        scope: SearchScope.EVERYTHING, // Default for standard LSP request
        maxResults: 50,
    });

    return results.map((r) => ({
        name: r.item.name,
        kind: mapItemTypeToSymbolKind(r.item.type),
        location: {
            uri: pathToFileURL(r.item.filePath).href,
            range: {
                start: { line: r.item.line || 0, character: r.item.column || 0 },
                end: { line: r.item.line || 0, character: (r.item.column || 0) + r.item.name.length },
            },
        },
        containerName: r.item.containerName,
    }));
});

// Custom handlers
connection.onRequest(BurstSearchRequest, (options) => {
    if (!isInitialized || isShuttingDown) return [];
    try {
        return searchEngine.burstSearch(options, (result) => {
            if (!isShuttingDown) {
                connection.sendNotification('deeplens/streamResult', { requestId: options.requestId, result });
            }
        });
    } catch (err: unknown) {
        const error = err as Error;
        fileLogger(`BurstSearch Error: ${error.message}\n${error.stack}`);
        throw err;
    }
});

connection.onRequest(ResolveItemsRequest, (params) => {
    if (!isInitialized) return [];
    return searchEngine.resolveItems(params.itemIds);
});

connection.onRequest(GetRecentItemsRequest, (params) => {
    if (!isInitialized || !activityTracker) return [];
    return activityTracker.getRecentItems(params.count);
});

// We can also override the main search with a custom request that supports Scopes
export const DeepLensSearchRequest = new RequestType<SearchOptions, SearchResult[], void>('deeplens/search');
connection.onRequest(DeepLensSearchRequest, async (options) => {
    if (!isInitialized || isShuttingDown) return [];
    fileLogger(`Search Request: "${options.query}" in scope ${options.scope}`);
    try {
        const results = await searchEngine.search(options, (result) => {
            if (!isShuttingDown) {
                connection.sendNotification('deeplens/streamResult', { requestId: options.requestId, result });
            }
        });
        fileLogger(`Search completed with ${results.length} results`);
        return results;
    } catch (err: unknown) {
        const error = err as Error;
        fileLogger(`Search Error: ${error.message}\n${error.stack}`);
        throw err;
    }
});

connection.onRequest(RecordActivityRequest, (params) => {
    if (activityTracker && searchEngine) {
        const item = searchEngine.itemsMap.get(params.itemId);
        if (item) {
            activityTracker.recordAccess(item);
        }
    }
});

connection.onRequest(RebuildIndexRequest, async () => {
    if (isShuttingDown) return;
    await runIndexingWithProgress();
});

connection.onRequest(ClearCacheRequest, async () => {
    if (isShuttingDown) return;
    if (activityTracker) await activityTracker.clearAll();
    await runIndexingWithProgress();
});

connection.onRequest(IndexStatsRequest, async () => {
    const stats = searchEngine.getStats();

    return {
        totalItems: stats.totalItems,
        totalFiles: stats.fileCount,
        totalTypes: stats.typeCount,
        totalSymbols: stats.symbolCount,
        lastUpdate: Date.now(),
        indexing: workspaceIndexer.isIndexing(),
        cacheSize: searchEngine.getCacheSize(),
    };
});

// Handle shutdown gracefully
connection.onShutdown(() => {
    return shutdownServer();
});

connection.onExit(() => {
    void shutdownServer(0);
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    const errorMsg = `Uncaught exception: ${error.message}\n${error.stack}`;
    fileLogger(errorMsg);
    if (!isShuttingDown) {
        try {
            connection.console.error(errorMsg);
        } catch {
            // Ignore if we can't log
        }
    }
});

process.on('unhandledRejection', (reason) => {
    const errorMsg = `Unhandled rejection: ${reason}`;
    fileLogger(errorMsg);
    if (!isShuttingDown) {
        try {
            connection.console.error(errorMsg);
        } catch {
            // Ignore if we can't log
        }
    }
});

// Listen on the connection
connection.listen();
