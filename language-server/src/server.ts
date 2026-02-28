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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ActivityTracker } from './core/activity-tracker';
import { Config } from './core/config';
import { FileProvider } from './core/providers/file-provider';
import { RecentProvider } from './core/providers/recent-provider';
import { SymbolProvider } from './core/providers/symbol-provider';
import { SearchEngine } from './core/search-engine';
import { TreeSitterParser } from './core/tree-sitter-parser';
import {
    IndexStats,
    RipgrepUnavailableNotification,
    SearchItemType,
    SearchOptions,
    SearchResult,
    SearchScope,
} from './core/types';
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
export const ClearHistoryRequest = new RequestType0<void, void>('deeplens/clearHistory');
export const RemoveHistoryItemRequest = new RequestType<{ itemId: string }, void, void>('deeplens/removeHistoryItem');
export const RebuildIndexRequest = new RequestType<{ force: boolean }, void, void>('deeplens/rebuildIndex');
export const ClearCacheRequest = new RequestType0<void, void>('deeplens/clearCache');
export const IndexStatsRequest = new RequestType0<IndexStats, void>('deeplens/indexStats');
export const SetActiveFilesRequest = new RequestType<{ files: string[] }, void, void>('deeplens/setActiveFiles');

// Create a connection for the server, using Node's stdin/stdout
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;

let searchEngine: SearchEngine;
let workspaceIndexer: WorkspaceIndexer;
let treeSitterParser: TreeSitterParser;
let config: Config;
let activityTracker: ActivityTracker;

let isInitialized = false;
let isShuttingDown = false;
let fileLogger: (msg: string) => void = () => {};
let parentProcessMonitor: NodeJS.Timeout | null = null;
let pendingRemovedFilePaths: Set<string> = new Set();
let removeBatchTimer: NodeJS.Timeout | null = null;

connection.onInitialize(async (params: InitializeParams) => {
    const capabilities = params.capabilities;

    hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

    // Monitor parent process
    if (params.processId) {
        parentProcessMonitor = setInterval(() => {
            try {
                // kill(pid, 0) checks if process exists without killing it
                process.kill(params.processId, 0);
            } catch {
                // Parent process is gone - clean up interval before exit
                if (parentProcessMonitor) {
                    clearInterval(parentProcessMonitor);
                    parentProcessMonitor = null;
                }
                process.exit(1);
            }
        }, 5000);
    }

    // Get storage path from initialization options or fall back to a temp dir
    let storagePath = params.initializationOptions?.storagePath || path.join(process.cwd(), '.deeplens');

    // Try to create storage directory with error handling
    try {
        await fs.promises.mkdir(storagePath, { recursive: true });
    } catch (error) {
        connection.console.error(`Failed to create storage directory at ${storagePath}: ${error}`);

        // Fall back to temp directory
        const tempPath = path.join(os.tmpdir(), 'deeplens-' + process.pid);
        try {
            await fs.promises.mkdir(tempPath, { recursive: true });
            storagePath = tempPath;
            connection.console.log(`Using temporary storage at ${tempPath}`);
        } catch (tempError) {
            connection.console.error(`Failed to create temp storage directory: ${tempError}`);
            // Continue without persistent storage - activity tracking will be disabled
        }
    }

    const logFile = path.join(storagePath, 'debug.log');
    let logQueue: string[] = [];
    let logWriting = false;

    const flushLogQueue = async () => {
        if (logWriting) {
            return;
        }
        logWriting = true;
        try {
            while (logQueue.length > 0) {
                const batch = logQueue.join('');
                logQueue = [];
                try {
                    await fs.promises.appendFile(logFile, batch);
                } catch {
                    break;
                }
            }
        } finally {
            logWriting = false;
        }
    };

    fileLogger = (msg: string) => {
        const timestamp = new Date().toISOString();
        logQueue.push(`[${timestamp}] ${msg}\n`);
        void flushLogQueue();
    };

    fileLogger('--- DeepLens Server Starting ---');
    fileLogger(`Storage Path: ${storagePath}`);
    fileLogger(`Node Version: ${process.version}`);
    fileLogger(`Platform: ${process.platform}`);

    // Resolve workspace folders
    let folders: string[] = [];
    if (params.workspaceFolders) {
        folders = params.workspaceFolders.map((f) => uriToPath(f.uri));
        // eslint-disable-next-line sonarjs/deprecation
    } else if (params.rootUri) {
        // eslint-disable-next-line sonarjs/deprecation
        folders = [uriToPath(params.rootUri)];
        // eslint-disable-next-line sonarjs/deprecation
    } else if (params.rootPath) {
        // eslint-disable-next-line sonarjs/deprecation
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
    // T011: Wire ripgrep unavailable notification
    searchEngine.ripgrep?.setUnavailableCallback(() => {
        connection.sendNotification(RipgrepUnavailableNotification, {});
    });
    searchEngine.setLogger({
        log: (msg) => connection.console.log(msg),
        error: (msg) => connection.console.error(msg),
    });

    documents.listen(connection);

    workspaceIndexer.onItemsAdded(async (items) => {
        try {
            await searchEngine.addItems(items);
        } catch (err) {
            connection.console.error(`Error adding items to search engine: ${err}`);
        }
    });

    workspaceIndexer.onItemsRemoved((filePath) => {
        pendingRemovedFilePaths.add(filePath);
        if (!removeBatchTimer) {
            removeBatchTimer = setTimeout(() => {
                if (pendingRemovedFilePaths.size === 0) {
                    removeBatchTimer = null;
                    return;
                }
                const files = Array.from(pendingRemovedFilePaths);
                pendingRemovedFilePaths = new Set();
                removeBatchTimer = null;
                searchEngine.removeItemsByFiles(files);
            }, 10);
        }
    });

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

let currentIndexingPromise: Promise<void> | null = null;

/**
 * Run indexing with progress reporting
 */
async function runIndexingWithProgress(force: boolean = false): Promise<void> {
    // If indexing is already running, cancel it and wait for it to stop
    if (currentIndexingPromise !== null) {
        workspaceIndexer.cancel();
        try {
            await currentIndexingPromise;
        } catch {
            // Ignore errors from the cancelled process
        }
    }

    const token = 'indexing-' + Date.now();

    // We need to wait a small bit for the client to be ready for requests immediately after initialized
    // but creating the progress token handles the handshake
    try {
        await connection.sendRequest('window/workDoneProgress/create', { token });
    } catch (e) {
        connection.console.error(`Failed to create progress token: ${e}`);
    }

    const indexingTask = async () => {
        // Clear existing items to prevent duplicates on rebuild
        searchEngine.clear();
        if (force) {
            workspaceIndexer.resetCaches();
        }

        try {
            const startTime = Date.now();
            let currentPercentage = 0;

            // Enhanced progress callback with phase-specific messages
            await workspaceIndexer.indexWorkspace((message, increment) => {
                if (increment) {
                    currentPercentage += increment;
                }
                // Cap at 99% until explicitly done
                const percentage = Math.min(99, Math.round(currentPercentage));
                if (!isShuttingDown) {
                    // Enhance message with phase context
                    let enhancedMessage = message;

                    // Add phase-specific context for better visual feedback
                    if (message.includes('Step 1/4')) {
                        enhancedMessage = '📊 Scanning repository structure...';
                    } else if (message.includes('Step 2/4')) {
                        enhancedMessage = '🔍 Scanning workspace files...';
                    } else if (message.includes('Step 3/4')) {
                        enhancedMessage = '⚡ Extracting symbols...';
                    } else if (message.includes('Step 4/4')) {
                        enhancedMessage = '✅ Finalizing...';
                    } else if (message.includes('Analyzing repository')) {
                        enhancedMessage = '📊 Analyzing repository structure...';
                    } else if (message.includes('Scanning files')) {
                        enhancedMessage = '🔍 Scanning workspace files...';
                    } else if (message.includes('Extracting symbols')) {
                        enhancedMessage = '⚡ Extracting symbols from files...';
                    } else if (message.includes('Finalizing')) {
                        enhancedMessage = '✅ Finalizing index...';
                    } else if (message.includes('Fast-scanning workspace symbols')) {
                        enhancedMessage = '⚡ Fast-scanning workspace symbols...';
                    }

                    connection.sendNotification('deeplens/progress', {
                        token,
                        message: enhancedMessage,
                        percentage,
                    });
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
            currentIndexingPromise = null;
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
connection.onWorkspaceSymbol(async (params, token) => {
    if (!isInitialized) return [];

    const results = await searchEngine.search(
        {
            query: params.query,
            scope: SearchScope.EVERYTHING, // Default for standard LSP request
            maxResults: 20,
        },
        undefined, // streamCallback
        token, // Pass cancellation token
    );

    return results.map((r) => ({
        name: r.item.name,
        kind: mapItemTypeToSymbolKind(r.item.type),
        location: {
            uri: pathToFileURL(r.item.filePath).toString(),
            range: {
                start: { line: r.item.line || 0, character: r.item.column || 0 },
                end: { line: r.item.line || 0, character: (r.item.column || 0) + r.item.name.length },
            },
        },
        containerName: r.item.containerName,
    }));
});

// Custom handlers
connection.onRequest(BurstSearchRequest, async (options, token) => {
    if (!isInitialized || isShuttingDown) return [];
    try {
        return await searchEngine.burstSearch(
            options,
            (result) => {
                if (!isShuttingDown && !token?.isCancellationRequested) {
                    connection.sendNotification('deeplens/streamResult', { requestId: options.requestId, result });
                }
            },
            token,
        );
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
connection.onRequest(DeepLensSearchRequest, async (options, token) => {
    if (!isInitialized || isShuttingDown) return [];
    fileLogger(`Search Request: "${options.query}" in scope ${options.scope}`);
    try {
        const results = await searchEngine.search(
            options,
            (result) => {
                if (!isShuttingDown && !token?.isCancellationRequested) {
                    connection.sendNotification('deeplens/streamResult', { requestId: options.requestId, result });
                }
            },
            token,
        );
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

connection.onRequest(ClearHistoryRequest, async () => {
    if (!isInitialized || !activityTracker) return;
    await activityTracker.clearAll();
});

connection.onRequest(RemoveHistoryItemRequest, async (params) => {
    if (!isInitialized || !activityTracker) return;
    await activityTracker.removeItem(params.itemId);
});

connection.onRequest(RebuildIndexRequest, async (params) => {
    if (isShuttingDown) return;
    await runIndexingWithProgress(params?.force ?? false);
});

connection.onRequest(ClearCacheRequest, async () => {
    if (isShuttingDown) return;
    if (activityTracker) await activityTracker.clearAll();
    await runIndexingWithProgress();
});

connection.onRequest(IndexStatsRequest, async () => {
    const stats = searchEngine.getStats();
    const lastIndexTimestamp = workspaceIndexer.getLastIndexTimestamp();

    return {
        totalItems: stats.totalItems,
        totalFiles: stats.fileCount,
        totalTypes: stats.typeCount,
        totalSymbols: stats.symbolCount,
        lastUpdate: lastIndexTimestamp ?? Date.now(),
        indexing: workspaceIndexer.isIndexing(),
        cacheSize: searchEngine.getCacheSize(),
    };
});

connection.onRequest(SetActiveFilesRequest, (params) => {
    if (!isInitialized || isShuttingDown) return;
    searchEngine.setActiveFiles(params.files || []);
});

// Handle shutdown gracefully
connection.onShutdown(async () => {
    isShuttingDown = true;

    // Clear parent process monitor
    if (parentProcessMonitor) {
        clearInterval(parentProcessMonitor);
        parentProcessMonitor = null;
    }

    if (activityTracker) {
        await activityTracker.dispose();
    }
    connection.console.log('DeepLens Language Server shutting down');
});

connection.onExit(() => {
    isShuttingDown = true;
    process.exit(0);
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
    let reasonText: string;
    if (reason instanceof Error) {
        reasonText = `${reason.message}\n${reason.stack ?? ''}`;
    } else if (typeof reason === 'string') {
        reasonText = reason;
    } else {
        try {
            reasonText = JSON.stringify(reason);
        } catch {
            const tag = Object.prototype.toString.call(reason);
            reasonText = `Non-Error value: ${tag}`;
        }
    }
    const errorMsg = `Unhandled rejection: ${reasonText}`;
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
