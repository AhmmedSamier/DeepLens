import * as vscode from 'vscode';
import { ActivityTracker } from './activity-tracker';
import { CommandIndexer } from './command-indexer';
import { Config } from './config';
import { IndexPersistence } from './core/index-persistence';
import { SearchEngine } from './core/search-engine';
import { TreeSitterParser } from './core/tree-sitter-parser';
import { SearchItemType, SearchScope } from './core/types';
import { SearchProvider } from './search-provider';
import { WorkspaceIndexer } from './workspace-indexer';

let searchEngine: SearchEngine;
let workspaceIndexer: WorkspaceIndexer;
let searchProvider: SearchProvider;
let config: Config;
let activityTracker: ActivityTracker;
let commandIndexer: CommandIndexer;
let treeSitterParser: TreeSitterParser;
let indexPersistence: IndexPersistence;

// Debounce timer for git changes
let gitChangeDebounce: NodeJS.Timeout | undefined;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Find Everywhere extension is now active');

    // Initialize
    config = new Config();
    searchEngine = new SearchEngine();
    const treeSitterLogger = vscode.window.createOutputChannel('Find Everywhere (Tree-sitter)');
    treeSitterParser = new TreeSitterParser(context.extensionPath, treeSitterLogger);
    indexPersistence = new IndexPersistence(context.globalStorageUri.fsPath);
    workspaceIndexer = new WorkspaceIndexer(config, treeSitterParser, indexPersistence);
    activityTracker = new ActivityTracker(context);
    commandIndexer = new CommandIndexer(config);
    searchProvider = new SearchProvider(searchEngine, config, activityTracker, commandIndexer);
    // Initialize Tree-sitter (async)
    const treeSitterInit = treeSitterParser.init().catch((e) => console.error('Tree-sitter init failed:', e));

    // Register search command
    const searchCommand = vscode.commands.registerCommand('findEverywhere.search', async () => {
        await searchProvider.show();
    });

    // Register search endpoints command
    const searchEndpointsCommand = vscode.commands.registerCommand('findEverywhere.searchEndpoints', async () => {
        await searchProvider.show(SearchScope.ENDPOINTS);
    });

    // Register rebuild index command
    const rebuildCommand = vscode.commands.registerCommand('findEverywhere.rebuildIndex', async () => {
        vscode.window.showInformationMessage('Rebuilding Find Everywhere index...');
        await indexWorkspace(true);
    });

    // Register clear index cache command
    const clearCacheCommand = vscode.commands.registerCommand('findEverywhere.clearIndexCache', async () => {
        await indexPersistence.clear();
        vscode.window.showInformationMessage('Find Everywhere: Index cache cleared.');
    });

    context.subscriptions.push(searchCommand);
    context.subscriptions.push(searchEndpointsCommand);
    context.subscriptions.push(rebuildCommand);
    context.subscriptions.push(clearCacheCommand);



    // Track document opens for activity
    if (config.isActivityTrackingEnabled()) {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    activityTracker.recordAccess(`file:${editor.document.uri.fsPath}`);
                }
            }),
        );
    }

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('findEverywhere')) {
                config.reload();
                // Re-index workspace if exclude patterns or file extensions changed
                if (
                    event.affectsConfiguration('findEverywhere.excludePatterns') ||
                    event.affectsConfiguration('findEverywhere.fileExtensions')
                ) {
                    indexWorkspace();
                }
            }
        }),
    );

    // Register indexer for disposal and listen for incremental updates
    context.subscriptions.push(
        workspaceIndexer.onDidChangeItems((workspaceItems) => {
            const commandItems = commandIndexer.getCommands();
            const allItems = [...workspaceItems, ...commandItems];
            searchEngine.setItems(allItems);
        }),
    );

    context.subscriptions.push({
        dispose: () => {
            workspaceIndexer.dispose();
            if (gitChangeDebounce) {
                clearTimeout(gitChangeDebounce);
            }
        },
    });

    // Final Setup: Index Workspace and Listen for Git
    await treeSitterInit;
    await indexWorkspace();
    setupGitListener(context);
}

/**
 * Index workspace
 */
async function indexWorkspace(force: boolean = false): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Find Everywhere',
            cancellable: false,
        },
        async (progress) => {
            try {
                const startTime = Date.now();
                workspaceIndexer.log(`Starting workspace index (force=${force})...`);

                // Index workspace files and symbols
                await workspaceIndexer.indexWorkspace((message, increment) => {
                    progress.report({ message, increment });
                }, force);

                // Index commands
                progress.report({ message: 'Indexing commands...', increment: 5 });
                await commandIndexer.indexCommands();

                // Combine all items
                const workspaceItems = workspaceIndexer.getItems();
                const commandItems = commandIndexer.getCommands();
                const allItems = [...workspaceItems, ...commandItems];

                const fileCount = workspaceItems.filter((i) => i.type === SearchItemType.FILE).length;
                const endpointCount = workspaceItems.filter((i) => i.type === SearchItemType.ENDPOINT).length;
                const symbolCount = workspaceItems.length - fileCount - endpointCount;
                const commandCount = commandItems.length;
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                searchEngine.setItems(allItems);

                // Show completion notification
                const message = `Find Everywhere: Indexed ${fileCount} files, ${symbolCount} symbols, ${endpointCount} endpoints, ${commandCount} commands in ${duration}s`;
                vscode.window.showInformationMessage(message);
                workspaceIndexer.log(`Index complete: ${message}`);
                // Cooldown watchers after full index to avoid git checkout event storms
                workspaceIndexer.cooldownFileWatchers();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to index workspace: ${error}`);
                workspaceIndexer.log(`Index failed: ${error}`);
            }
        },
    );
}

/**
 * Index individual files when they change
 */
async function handleFileChange(uri: vscode.Uri): Promise<void> {
    // This is handled by WorkspaceIndexer internal watchers now
}

/**
 * Setup git repository listener for branch changes
 */
function setupGitListener(context: vscode.ExtensionContext): void {
    try {
        // Get the git extension
        const gitExtension = vscode.extensions.getExtension('vscode.git');

        if (!gitExtension) {
            console.log('Git extension not found - skipping git change detection');
            return;
        }

        // Activate git extension if not already active
        gitExtension.exports
            .getAPI(1)
            .then((git: any) => {
                if (!git || typeof git !== 'object') {
                    console.log('Failed to get git API object');
                    return;
                }

                workspaceIndexer.log('Git API obtained successfully');

                const gitApi = git as {
                    repositories: any[];
                    onDidOpenRepository: (cb: (repo: any) => void) => vscode.Disposable;
                };

                // Setup listeners for all current and future repositories
                gitApi.repositories.forEach(repo => setupRepositoryListener(repo));
                context.subscriptions.push(gitApi.onDidOpenRepository(repo => setupRepositoryListener(repo)));

                workspaceIndexer.log(`Git listener setup complete. Monitoring ${gitApi.repositories.length} repositories.`);
            })
            .catch((error: unknown) => {
                console.error('Failed to get git API:', error);
            });
    } catch (error) {
        console.error('Error setting up git listener:', error);
    }
}

/**
 * Setup listener for individual repository
 */
function setupRepositoryListener(repository: any): void {
    if (!repository || typeof repository !== 'object') {
        return;
    }

    // Keep track of the last known HEAD to detect branch switches/commits
    let lastHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;
    workspaceIndexer.log(`Monitoring repository at ${repository.rootUri.fsPath} (Initial HEAD: ${lastHead})`);

    // Listen for state changes (branch switches, commits, pull/push updates)
    repository.state.onDidChange(() => {
        const currentHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;

        if (currentHead !== lastHead) {
            workspaceIndexer.log(`Git detected HEAD change in ${repository.rootUri.fsPath}: ${lastHead} -> ${currentHead}`);
            lastHead = currentHead;

            if (gitChangeDebounce) {
                clearTimeout(gitChangeDebounce);
            }

            gitChangeDebounce = setTimeout(async () => {
                workspaceIndexer.log(`[Git Event] Head moved from ${lastHead} to ${currentHead}. Triggering full workspace refresh.`);
                // Trigger index with progress visible to user
                await indexWorkspace(false);
                workspaceIndexer.log('[Git Event] Workspace refresh finished.');
            }, 3000); // 3 second pause to ensure disk settling after checkout/pull
        }
    });
}

/**
 * Extension deactivation
 */
export function deactivate() {
    if (workspaceIndexer) {
        workspaceIndexer.dispose();
    }
    if (activityTracker) {
        activityTracker.dispose();
    }
    if (gitChangeDebounce) {
        clearTimeout(gitChangeDebounce);
    }
}
