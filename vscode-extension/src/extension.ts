import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { Config } from '../../language-server/src/core/config';
import { SearchItemType, SearchScope, SearchableItem } from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';
import { ReferenceCodeLensProvider } from './reference-code-lens';
import { SearchProvider } from './search-provider';
import { GitService } from './services/git-service';
import { logger } from './services/logging-service';

let lspClient: DeepLensLspClient;
let searchProvider: SearchProvider;
let config: Config;
let activityTracker: ActivityTracker;
let commandIndexer: CommandIndexer;
let gitService: GitService;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    logger.log('DeepLens extension is now active');

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
        const editor = vscode.window.activeTextEditor;
        let initialQuery: string | undefined;

        if (editor && !editor.selection.isEmpty) {
            initialQuery = editor.document.getText(editor.selection);
        }

        await searchProvider.show(SearchScope.EVERYTHING, initialQuery);
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
                alwaysShow: true,
            },
            {
                label: '$(refresh) Rebuild Index',
                description: 'Force a full re-index of the workspace',
                picked: false,
            },
            {
                label: '$(trash) Clear Cache',
                description: 'Clear the persistent index cache',
                picked: false,
            },
            {
                label: '$(settings-gear) Configure Settings',
                description: 'Open DeepLens extension settings',
                picked: false,
            },
        ];

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'DeepLens Index Statistics & Actions',
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
    lspClient.onProgress.event((e) => {
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

    context.subscriptions.push(vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider));
    context.subscriptions.push(codeLensProvider);

    // Track document opens for activity
    if (config.isActivityTrackingEnabled()) {
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    const itemId = `file:${editor.document.uri.fsPath}`;
                    const item: SearchableItem = {
                        id: itemId,
                        name: path.basename(editor.document.uri.fsPath),
                        type: SearchItemType.FILE,
                        filePath: editor.document.uri.fsPath,
                        detail: 'Recently opened',
                    };
                    activityTracker.recordAccess(item);
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

    // Initialize Git Service
    gitService = new GitService(async () => {
        await indexWorkspace(false);
    });
    context.subscriptions.push(gitService);
    await gitService.setupGitListener(context);

    // Register listener for disposal
    context.subscriptions.push({
        dispose: () => {
            lspClient.stop();
        },
    });

    // Index commands initially
    await commandIndexer.indexCommands();

    return {
        searchProvider,
        lspClient,
    };
}

/**
 * Workspace indexing is now handled by the LSP server.
 * This wrapper remains for git events.
 */
async function indexWorkspace(force: boolean = false): Promise<void> {
    await lspClient.rebuildIndex(force);
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
    if (gitService) {
        gitService.dispose();
    }
}
