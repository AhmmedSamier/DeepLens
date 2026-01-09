import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { CommandIndexer } from './command-indexer';
import { Config } from '../../language-server/src/core/config';
import { SearchProvider } from './search-provider';
import { DeepLensLspClient } from './lsp-client';

let lspClient: DeepLensLspClient;
let searchProvider: SearchProvider;
let config: Config;
let activityTracker: ActivityTracker;
let commandIndexer: CommandIndexer;

// Debounce timer for git changes
let gitChangeDebounce: NodeJS.Timeout | undefined;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('DeepLens extension is now active');

    // Initialize
    config = new Config(vscode.workspace.getConfiguration('deeplens'));

    // Start LSP Client
    lspClient = new DeepLensLspClient(context);
    await lspClient.start();

    // Command Indexer still runs locally for VS Code commands
    commandIndexer = new CommandIndexer(config);
    activityTracker = new ActivityTracker(context);

    // UI remains local
    searchProvider = new SearchProvider(lspClient, config, activityTracker, commandIndexer);

    // Register search command
    const searchCommand = vscode.commands.registerCommand('deeplens.search', async () => {
        await searchProvider.show();
    });

    // Register rebuild index command
    const rebuildCommand = vscode.commands.registerCommand('deeplens.rebuildIndex', async () => {
        vscode.window.showInformationMessage('Rebuilding DeepLens index...');
        await lspClient.rebuildIndex(true);
    });

    // Register clear index cache command
    const clearCacheCommand = vscode.commands.registerCommand('deeplens.clearIndexCache', async () => {
        await lspClient.clearCache();
        vscode.window.showInformationMessage('DeepLens: Index cache cleared.');
    });

    context.subscriptions.push(searchCommand);
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
            if (event.affectsConfiguration('deeplens')) {
                config.reload(vscode.workspace.getConfiguration('deeplens'));
                // Re-index workspace if exclude patterns or file extensions changed
                if (
                    event.affectsConfiguration('deeplens.excludePatterns') ||
                    event.affectsConfiguration('deeplens.fileExtensions')
                ) {
                    indexWorkspace();
                }
            }
        }),
    );

    // Register listener for disposal
    context.subscriptions.push({
        dispose: () => {
            lspClient.stop();
            if (gitChangeDebounce) {
                clearTimeout(gitChangeDebounce);
            }
        },
    });

    // Index commands initially
    await commandIndexer.indexCommands();

    // Git listener for full re-index (server side does file watching, but git branch changes need full scan)
    setupGitListener(context);
}

/**
 * Workspace indexing is now handled by the LSP server.
 * This wrapper remains for git events.
 */
async function indexWorkspace(force: boolean = false): Promise<void> {
    await lspClient.rebuildIndex(force);
}



interface GitRepository {
    rootUri: vscode.Uri;
    state: {
        HEAD?: {
            commit?: string;
            name?: string;
        };
        onDidChange: (cb: () => void) => vscode.Disposable;
    };
}

interface GitAPI {
    repositories: GitRepository[];
    onDidOpenRepository: (cb: (repo: GitRepository) => void) => vscode.Disposable;
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
            .then((git: unknown) => {
                const gitApi = git as GitAPI;
                if (!gitApi || typeof gitApi !== 'object') {
                    console.log('Failed to get git API object');
                    return;
                }

                console.log('Git API obtained successfully');

                // Setup listeners for all current and future repositories
                gitApi.repositories.forEach((repo) => setupRepositoryListener(repo));
                context.subscriptions.push(gitApi.onDidOpenRepository((repo) => setupRepositoryListener(repo)));

                console.log(
                    `Git listener setup complete. Monitoring ${gitApi.repositories.length} repositories.`,
                );
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
function setupRepositoryListener(repository: GitRepository): void {
    if (!repository || typeof repository !== 'object') {
        return;
    }

    // Keep track of the last known HEAD to detect branch switches/commits
    let lastHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;
    console.log(`Monitoring repository at ${repository.rootUri.fsPath} (Initial HEAD: ${lastHead})`);

    // Listen for state changes (branch switches, commits, pull/push updates)
    repository.state.onDidChange(() => {
        const currentHead = repository.state.HEAD?.commit || repository.state.HEAD?.name;

        if (currentHead !== lastHead) {
            console.log(
                `Git detected HEAD change in ${repository.rootUri.fsPath}: ${lastHead} -> ${currentHead}`,
            );
            lastHead = currentHead;

            if (gitChangeDebounce) {
                clearTimeout(gitChangeDebounce);
            }

            gitChangeDebounce = setTimeout(async () => {
                console.log(
                    `[Git Event] Head moved from ${lastHead} to ${currentHead}. Triggering full workspace refresh.`,
                );
                // Trigger index with progress visible to user
                await indexWorkspace(false);
                console.log('[Git Event] Workspace refresh finished.');
            }, 3000); // 3 second pause to ensure disk settling after checkout/pull
        }
    });
}

/**
 * Extension deactivation
 */
export function deactivate() {
    if (lspClient) {
        lspClient.stop();
    }
    if (activityTracker) {
        activityTracker.dispose();
    }
    if (gitChangeDebounce) {
        clearTimeout(gitChangeDebounce);
    }
}
