import * as vscode from 'vscode';
import { SearchEngine } from './core/search-engine';
import { WorkspaceIndexer } from './workspace-indexer';
import { SearchProvider } from './search-provider';
import { Config } from './config';
import { ActivityTracker } from './activity-tracker';
import { CommandIndexer } from './command-indexer';
import { TreeSitterParser } from './core/tree-sitter-parser';
import { IndexPersistence } from './core/index-persistence';

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
    treeSitterParser = new TreeSitterParser(context.extensionPath);
    indexPersistence = new IndexPersistence(context.globalStorageUri.fsPath);
    workspaceIndexer = new WorkspaceIndexer(config, treeSitterParser, indexPersistence);
    activityTracker = new ActivityTracker(context);
    commandIndexer = new CommandIndexer(config);
    searchProvider = new SearchProvider(searchEngine, config, activityTracker, commandIndexer);

    // Initialize Tree-sitter (async)
    treeSitterParser.init().catch(e => console.error('Tree-sitter init failed:', e));

    // Register search command
    const searchCommand = vscode.commands.registerCommand('findEverywhere.search', async () => {
        await searchProvider.show();
    });

    // Register rebuild index command
    const rebuildCommand = vscode.commands.registerCommand('findEverywhere.rebuildIndex', async () => {
        vscode.window.showInformationMessage('Rebuilding Find Everywhere index...');
        await indexWorkspace();
    });

    context.subscriptions.push(searchCommand);
    context.subscriptions.push(rebuildCommand);

    // Start workspace indexing
    await indexWorkspace();

    // Listen for git repository state changes (branch switches, etc.)
    setupGitListener(context);

    // Track document opens for activity
    if (config.isActivityTrackingEnabled()) {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    activityTracker.recordAccess(`file:${editor.document.uri.fsPath}`);
                }
            })
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
        })
    );

    // Register indexer for disposal
    context.subscriptions.push({
        dispose: () => {
            workspaceIndexer.dispose();
            if (gitChangeDebounce) {
                clearTimeout(gitChangeDebounce);
            }
        },
    });

    // Show status bar item during indexing
    showIndexingStatus();
}

/**
 * Index workspace
 */
async function indexWorkspace(): Promise<void> {
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

                // Index workspace files and symbols
                await workspaceIndexer.indexWorkspace((message, increment) => {
                    progress.report({ message, increment });
                });

                // Index commands
                progress.report({ message: 'Indexing commands...', increment: 95 });
                await commandIndexer.indexCommands();

                // Combine all items
                const workspaceItems = workspaceIndexer.getItems();
                const commandItems = commandIndexer.getCommands();
                const allItems = [...workspaceItems, ...commandItems];

                const fileCount = workspaceItems.filter(i => i.type === 'file').length;
                const symbolCount = workspaceItems.length - fileCount;
                const commandCount = commandItems.length;
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                progress.report({
                    message: `Complete! ${fileCount} files, ${symbolCount} symbols, ${commandCount} commands in ${duration}s`,
                    increment: 100
                });

                searchEngine.setItems(allItems);

                // Show completion message
                vscode.window.showInformationMessage(
                    `Find Everywhere: Indexed ${fileCount} files, ${symbolCount} symbols, ${commandCount} commands in ${duration}s`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to index workspace: ${error}`);
            }
        }
    );
}

/**
 * Show indexing status
 */
function showIndexingStatus(): void {
    const interval = setInterval(() => {
        if (workspaceIndexer.isIndexing()) {
            vscode.window.setStatusBarMessage('$(sync~spin) Indexing workspace...', 1000);
        } else {
            clearInterval(interval);
        }
    }, 1000);
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
        gitExtension.exports.getAPI(1).then((git: any) => {
            if (!git) {
                return;
            }

            // Listen to all repositories
            const repositories = git.repositories;

            if (repositories.length === 0) {
                // Wait for repositories to be initialized
                const disposable = git.onDidOpenRepository((repo: any) => {
                    setupRepositoryListener(repo);
                    disposable.dispose();
                });
                context.subscriptions.push(disposable);
            } else {
                // Setup listeners for existing repositories
                repositories.forEach((repo: any) => {
                    setupRepositoryListener(repo);
                });
            }
        }).catch((error: any) => {
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
    // Listen for HEAD changes (branch switches, commits, etc.)
    repository.state.onDidChange(() => {
        // Debounce re-indexing to avoid excessive calls
        if (gitChangeDebounce) {
            clearTimeout(gitChangeDebounce);
        }

        gitChangeDebounce = setTimeout(async () => {
            console.log('Git state changed - re-indexing workspace');
            vscode.window.setStatusBarMessage('$(sync~spin) Re-indexing after git change...', 2000);
            await indexWorkspace();
        }, 1000); // Wait 1 second after git changes settle
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
