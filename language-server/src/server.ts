import {
    createConnection,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    SymbolKind,
    TextDocumentSyncKind,
    InitializeResult,
    RequestType,
} from 'vscode-languageserver/node';

import * as path from 'path';
import * as fs from 'fs';
import { SearchEngine } from './core/search-engine';
import { WorkspaceIndexer } from './core/workspace-indexer';
import { TreeSitterParser } from './core/tree-sitter-parser';
import { IndexPersistence } from './core/index-persistence';
import { Config } from './core/config';
import { SearchItemType, SearchScope, SearchOptions, SearchResult, IndexStats } from './core/types';
import { ActivityTracker } from './core/activity-tracker';
import { LspIndexerEnvironment } from './indexer-client';

// Custom requests
export const BurstSearchRequest = new RequestType<SearchOptions, SearchResult[], void>('deeplens/burstSearch');
export const RecordActivityRequest = new RequestType<{ itemId: string }, void, void>('deeplens/recordActivity');
export const RebuildIndexRequest = new RequestType<{ force: boolean }, void, void>('deeplens/rebuildIndex');
export const ClearCacheRequest = new RequestType<void, void, void>('deeplens/clearCache');
export const IndexStatsRequest = new RequestType<void, IndexStats, void>('deeplens/indexStats');

// Create a connection for the server, using Node's stdin/stdout
const connection = createConnection(ProposedFeatures.all);

let hasConfigurationCapability = false;

let searchEngine: SearchEngine;
let workspaceIndexer: WorkspaceIndexer;
let treeSitterParser: TreeSitterParser;
let indexPersistence: IndexPersistence;
let config: Config;
let activityTracker: ActivityTracker;

let isInitialized = false;

connection.onInitialize(async (params: InitializeParams) => {
    const capabilities = params.capabilities;

    hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

    // Get storage path from initialization options or fall back to a temp dir
    const storagePath = params.initializationOptions?.storagePath || path.join(process.cwd(), '.deeplens');
    if (!fs.existsSync(storagePath)) {
        fs.mkdirSync(storagePath, { recursive: true });
    }

    // Resolve workspace folders
    let folders: string[] = [];
    if (params.workspaceFolders) {
        folders = params.workspaceFolders.map(f => {
            const uri = f.uri;
            if (uri.startsWith('file:///')) {
                return path.normalize(decodeURIComponent(uri.slice(8)));
            }
            if (uri.startsWith('file://')) {
                return path.normalize(decodeURIComponent(uri.slice(7)));
            }
            return uri;
        });
    } else if (params.rootUri) {
        if (params.rootUri.startsWith('file:///')) {
            folders = [path.normalize(decodeURIComponent(params.rootUri.slice(8)))];
        } else if (params.rootUri.startsWith('file://')) {
            folders = [path.normalize(decodeURIComponent(params.rootUri.slice(7)))];
        } else {
            folders = [params.rootUri];
        }
    } else if (params.rootPath) {
        folders = [params.rootPath];
    }

    // Initialize core components
    config = new Config();

    // extensionPath is needed for TreeSitter parsers to find WASM files
    const extensionPath = params.initializationOptions?.extensionPath || process.cwd();
    treeSitterParser = new TreeSitterParser(extensionPath, {
        appendLine: (msg) => connection.console.log(msg)
    });
    await treeSitterParser.init();

    indexPersistence = new IndexPersistence(storagePath);

    const indexerEnv = new LspIndexerEnvironment(connection, folders);
    workspaceIndexer = new WorkspaceIndexer(config, treeSitterParser, indexPersistence, indexerEnv);

    activityTracker = new ActivityTracker(storagePath);
    searchEngine = new SearchEngine();

    // Wire up search engine to indexer
    workspaceIndexer.onDidChangeItems((items) => searchEngine.setItems(items));
    searchEngine.setItems(workspaceIndexer.getItems());

    if (config.isActivityTrackingEnabled()) {
        searchEngine.setActivityCallback(
            (itemId) => activityTracker.getActivityScore(itemId),
            config.getActivityWeight()
        );
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports workspace symbols.
            workspaceSymbolProvider: true,
        }
    };
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }

    // Initial indexing with progress
    runIndexingWithProgress(false).then(() => {
        isInitialized = true;
        connection.console.log('DeepLens index built successfully');
    });
});

/**
 * Run indexing with progress reporting
 */
async function runIndexingWithProgress(force: boolean): Promise<void> {
    const token = 'indexing-' + Date.now();
    try {
        // We need to wait a small bit for the client to be ready for requests immediately after initialized
        // but creating the progress token handles the handshake
        await connection.sendRequest('window/workDoneProgress/create', { token });

        const startTime = Date.now();
        let currentPercentage = 0;
        await workspaceIndexer.indexWorkspace((message, increment) => {
            if (increment) {
                currentPercentage += increment;
            }
            // Cap at 99% until explicitly done
            const percentage = Math.min(99, Math.round(currentPercentage));
            connection.sendNotification('deeplens/progress', { token, message, percentage });
        }, force);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        connection.sendNotification('deeplens/progress', { token, message: `Done (${duration}s)`, percentage: 100 });
    } catch (error) {
        connection.console.error(`Error reporting progress: ${error}`);
        // Fallback without progress
        await workspaceIndexer.indexWorkspace(undefined, force);
    }
}

// Map SearchItemType to SymbolKind
function mapItemTypeToSymbolKind(type: SearchItemType): SymbolKind {
    switch (type) {
        case SearchItemType.FILE: return SymbolKind.File;
        case SearchItemType.CLASS: return SymbolKind.Class;
        case SearchItemType.INTERFACE: return SymbolKind.Interface;
        case SearchItemType.ENUM: return SymbolKind.Enum;
        case SearchItemType.FUNCTION: return SymbolKind.Function;
        case SearchItemType.METHOD: return SymbolKind.Method;
        case SearchItemType.PROPERTY: return SymbolKind.Property;
        case SearchItemType.VARIABLE: return SymbolKind.Variable;
        default: return SymbolKind.Object;
    }
}

// Implement workspace/symbol
connection.onWorkspaceSymbol((params) => {
    if (!isInitialized) return [];

    const results = searchEngine.search({
        query: params.query,
        scope: SearchScope.EVERYTHING, // Default for standard LSP request
        maxResults: 50
    });

    return results.map(r => ({
        name: r.item.name,
        kind: mapItemTypeToSymbolKind(r.item.type),
        location: {
            uri: `file://${r.item.filePath.replace(/\\/g, '/')}`,
            range: {
                start: { line: r.item.line || 0, character: r.item.column || 0 },
                end: { line: r.item.line || 0, character: (r.item.column || 0) + r.item.name.length }
            }
        },
        containerName: r.item.containerName
    }));
});

// Custom handlers
connection.onRequest(BurstSearchRequest, (options) => {
    if (!isInitialized) return [];
    return searchEngine.burstSearch(options);
});

// We can also override the main search with a custom request that supports Scopes
export const DeepLensSearchRequest = new RequestType<SearchOptions, SearchResult[], void>('deeplens/search');
connection.onRequest(DeepLensSearchRequest, (options) => {
    if (!isInitialized) return [];
    return searchEngine.search(options);
});

connection.onRequest(RecordActivityRequest, (params) => {
    if (activityTracker) {
        activityTracker.recordAccess(params.itemId);
    }
});

connection.onRequest(RebuildIndexRequest, async (params) => {
    await runIndexingWithProgress(params.force);
});

connection.onRequest(ClearCacheRequest, async () => {
    await indexPersistence.clear();
    await workspaceIndexer.indexWorkspace(undefined, true);
});

connection.onRequest(IndexStatsRequest, () => {
    const items = workspaceIndexer.getItems();
    const fileItems = items.filter(i => i.type === SearchItemType.FILE);
    const typeItems = items.filter(i =>
        i.type === SearchItemType.CLASS ||
        i.type === SearchItemType.INTERFACE ||
        i.type === SearchItemType.ENUM
    );
    const symbolItems = items.filter(i =>
        i.type === SearchItemType.METHOD ||
        i.type === SearchItemType.FUNCTION ||
        i.type === SearchItemType.PROPERTY
    );

    return {
        totalItems: items.length,
        totalFiles: fileItems.length,
        totalTypes: typeItems.length,
        totalSymbols: symbolItems.length,
        lastUpdate: Date.now(),
        indexing: workspaceIndexer.isIndexing(),
        cacheSize: indexPersistence.getCacheSize()
    };
});

// Listen on the connection
connection.listen();
