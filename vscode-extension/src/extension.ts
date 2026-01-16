import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { CommandIndexer } from './command-indexer';
import { Config } from '../../language-server/src/core/config';
import { SearchProvider } from './search-provider';
import { DeepLensLspClient } from './lsp-client';
import { ReferenceCodeLensProvider } from './reference-code-lens';

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

    // Status Bar Item
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusItem.text = '$(database) DeepLens';
    statusItem.tooltip = 'DeepLens Index Status';
    statusItem.command = 'deeplens.showIndexStats';
    statusItem.show();
    context.subscriptions.push(statusItem);

    // Register show index stats command
    const showStatsCommand = vscode.commands.registerCommand('deeplens.showIndexStats', async () => {
        const stats = await lspClient.getIndexStats();
        if (!stats) {
            vscode.window.showErrorMessage('DeepLens: Could not retrieve index statistics.');
            return;
        }

        const sizeInMB = (stats.cacheSize / (1024 * 1024)).toFixed(2);

        const items: vscode.QuickPickItem[] = [
            {
                label: `$(database) Index Status`,
                detail: `${stats.totalItems} items (${stats.totalFiles} files, ${stats.totalSymbols} symbols) • ${sizeInMB} MB`,
                alwaysShow: true
            },
            {
                label: '$(refresh) Rebuild Index',
                description: 'Force a full re-index of the workspace',
                picked: false
            },
            {
                label: '$(trash) Clear Cache',
                description: 'Clear the persistent index cache',
                picked: false
            },
            {
                label: '$(settings-gear) Configure Settings',
                description: 'Open DeepLens extension settings',
                picked: false
            }
        ];

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'DeepLens Index Statistics & Actions'
        });

        if (selection) {
            if (selection.label === '$(refresh) Rebuild Index') {
                vscode.commands.executeCommand('deeplens.rebuildIndex');
            } else if (selection.label === '$(trash) Clear Cache') {
                vscode.commands.executeCommand('deeplens.clearIndexCache');
            } else if (selection.label === '$(settings-gear) Configure Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens');
            }
        }
    });
    context.subscriptions.push(showStatsCommand);

    // Listen to progress to update status bar
    lspClient.onProgress.event(e => {
        if (e.state === 'start') {
            statusItem.text = '$(sync~spin) Indexing...';
            statusItem.tooltip = 'DeepLens is indexing your workspace...';
        } else if (e.state === 'end') {
            statusItem.text = '$(database) DeepLens';
            statusItem.tooltip = 'DeepLens Index Status';
        }
    });

    // Register reference code lens provider for all supported languages
    const codeLensProvider = new ReferenceCodeLensProvider();
    const supportedLanguages = [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' },
        { scheme: 'file', language: 'csharp' },
        { scheme: 'file', language: 'python' },
        { scheme: 'file', language: 'java' },
        { scheme: 'file', language: 'go' },
        { scheme: 'file', language: 'cpp' },
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'ruby' },
        { scheme: 'file', language: 'php' },
    ];

    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider)
    );
    context.subscriptions.push(codeLensProvider);

    // Track document opens for activity
    if (config.isActivityTrackingEnabled()) {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    const itemId = `file:${editor.document.uri.fsPath}`;
                    activityTracker.recordAccess(itemId);
                    lspClient.recordActivity(itemId);
                }
            }),
        );
    }

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('deeplens')) {
                config.reload(vscode.workspace.getConfiguration('deeplens'));

                // Reload codeLens provider config
                if (event.affectsConfiguration('deeplens.codeLens')) {
                    codeLensProvider.reloadConfig();
                }

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
async function setupGitListener(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Get the git extension
        const gitExtension = vscode.extensions.getExtension('vscode.git');

        if (!gitExtension) {
            console.log('Git extension not found - skipping git change detection');
            return;
        }

        // Activate git extension if not already active
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }

        // Get the API - getAPI returns synchronously after activation
        const gitApi = gitExtension.exports?.getAPI?.(1) as GitAPI | undefined;

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
