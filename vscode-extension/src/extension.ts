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
    try {
        await lspClient.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to start DeepLens language server: ${message}`);
        vscode.window.showErrorMessage(
            'DeepLens: Failed to start language server. Check the output log for details.',
        );
        return;
    }

    // Command Indexer still runs locally for VS Code commands
    commandIndexer = new CommandIndexer(config);
    activityTracker = new ActivityTracker(context);

    // UI remains local
    searchProvider = new SearchProvider(lspClient, config, activityTracker, commandIndexer);

    const updateActiveFiles = () => {
        const activeFiles: string[] = [];

        // Use tabGroups to get files actually open in tabs (more accurate than textDocuments)
        if (typeof vscode.window.tabGroups !== 'undefined') {
            for (const group of vscode.window.tabGroups.all) {
                for (const tab of group.tabs) {
                    if (tab.input instanceof vscode.TabInputText) {
                        activeFiles.push(tab.input.uri.fsPath);
                    }
                }
            }
        } else {
            // Fallback for older VS Code versions
            const docs = vscode.workspace.textDocuments
                .filter((doc) => doc.uri.scheme === 'file')
                .map((doc) => doc.uri.fsPath);
            activeFiles.push(...docs);
        }

        const activeEditorPath = vscode.window.activeTextEditor?.document.uri;
        if (activeEditorPath?.scheme === 'file' && !activeFiles.includes(activeEditorPath.fsPath)) {
            activeFiles.push(activeEditorPath.fsPath);
        }

        // Deduplicate
        const uniqueFiles = Array.from(new Set(activeFiles));
        lspClient.setActiveFiles(uniqueFiles);
    };

    updateActiveFiles();
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(updateActiveFiles),
        vscode.workspace.onDidCloseTextDocument(updateActiveFiles),
        vscode.window.onDidChangeActiveTextEditor(updateActiveFiles),
    );

    if (typeof vscode.window.tabGroups !== 'undefined') {
        context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(updateActiveFiles));
    }

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
            statusItem.text = '$(sync~spin) DeepLens';
            statusItem.tooltip = 'DeepLens is indexing your workspace...';
            statusItem.color = '#ff9900'; // Orange for indexing
        } else if (e.state === 'report') {
            const percentageText = e.percentage !== undefined ? ` (${e.percentage}%)` : '';

            // Determine icon and color based on message content
            let icon = '$(sync~spin)';
            let color = '#ff9900'; // Default orange

            if (e.message?.includes('scanning') || e.message?.includes('Scanning')) {
                icon = '$(search)';
                color = '#007acc'; // Blue for scanning
            } else if (e.message?.includes('parsing') || e.message?.includes('Parsing')) {
                icon = '$(code)';
                color = '#7c4dff'; // Purple for parsing
            } else if (e.message?.includes('indexing') || e.message?.includes('Indexing')) {
                icon = '$(database)';
                color = '#00c853'; // Green for indexing
            } else if (e.message?.includes('symbols') || e.message?.includes('Symbols')) {
                icon = '$(symbol-parameter)';
                color = '#aa00ff'; // Dark purple for symbols
            }

            statusItem.text = `${icon} DeepLens${percentageText}`;
            if (e.message) {
                statusItem.tooltip = `DeepLens: ${e.message}`;
            }
            statusItem.color = color;
        } else if (e.state === 'end') {
            statusItem.text = '$(database) DeepLens';
            statusItem.tooltip = 'DeepLens Index Status';
            statusItem.color = '#cccccc'; // Gray for normal state
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
                if (editor && activityTracker) {
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
        commandIndexer,
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
export async function deactivate() {
    if (lspClient) {
        await lspClient.stop();
    }
    if (activityTracker) {
        await activityTracker.dispose();
    }
    if (gitService) {
        gitService.dispose();
    }
}
