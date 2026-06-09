import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'node:crypto';
import { Config } from '../../language-server/src/core/config';
import { SearchResult, SearchScope } from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { logger } from './services/logging-service';
import { SlashCommand, SlashCommandService } from './slash-command-service';
import { SearchService } from './services/search-service';

export class DeepLensViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = 'deeplens.searchView';
    private _view?: vscode.WebviewView;
    private currentScope: SearchScope = SearchScope.EVERYTHING;
    private lastQuery = '';
    private lastRequestId = 0;
    private textSearchEnabled = true;

    private readonly scopeConfig = [
        { scope: SearchScope.EVERYTHING, icon: 'search', label: 'All', shortcut: '/all', desc: 'Search everywhere' },
        { scope: SearchScope.OPEN, icon: 'book', label: 'Open', shortcut: '/o', desc: 'Search open editors' },
        {
            scope: SearchScope.MODIFIED,
            icon: 'git-merge',
            label: 'Modified',
            shortcut: '/m',
            desc: 'Search modified files',
        },
        {
            scope: SearchScope.TYPES,
            icon: 'symbol-class',
            label: 'Classes',
            shortcut: '/t',
            desc: 'Search types & interfaces',
        },
        {
            scope: SearchScope.SYMBOLS,
            icon: 'symbol-method',
            label: 'Symbols',
            shortcut: '/s',
            desc: 'Search methods & variables',
        },
        { scope: SearchScope.FILES, icon: 'file', label: 'Files', shortcut: '/f', desc: 'Search files by name' },
        { scope: SearchScope.TEXT, icon: 'whole-word', label: 'Text', shortcut: '/txt', desc: 'Search file content' },
        { scope: SearchScope.COMMANDS, icon: 'run', label: 'Commands', shortcut: '/cmd', desc: 'Run VS Code commands' },
        {
            scope: SearchScope.PROPERTIES,
            icon: 'symbol-property',
            label: 'Properties',
            shortcut: '/p',
            desc: 'Search properties',
        },
        {
            scope: SearchScope.ENDPOINTS,
            icon: 'globe',
            label: 'Endpoints',
            shortcut: '/e',
            desc: 'Search API endpoints',
        },
    ];

    private slashCommandService: SlashCommandService;
    private messageDisposable?: vscode.Disposable;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly lspClient: DeepLensLspClient,
        private readonly config: Config,
        private readonly activityTracker?: ActivityTracker,
        private readonly commandIndexer?: CommandIndexer,
    ) {
        this.slashCommandService = new SlashCommandService();
        this.searchService = new SearchService(lspClient, config, activityTracker, commandIndexer);
    }

    public dispose() {
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        this.messageDisposable?.dispose();
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        this.messageDisposable = webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'search':
                    this.handleSearch(data.query, data.scope);
                    break;
                case 'open':
                    this.handleOpen(data.result, false);
                    break;
                case 'preview':
                    this.handleOpen(data.result, true);
                    break;
                case 'recordActivity':
                    this.recordActivity(data.result);
                    break;
                case 'copyPath':
                    this.handleCopyPath(data.result);
                    break;
                case 'copyReference':
                    this.handleCopyReference(data.result);
                    break;
                case 'copyRelativePath':
                    this.handleCopyRelativePath(data.result);
                    break;
                case 'openSide':
                    this.handleOpenSide(data.result);
                    break;
                case 'reveal':
                    this.handleReveal(data.result);
                    break;
                case 'clearHistory':
                    await this.handleClearHistory();
                    break;
                case 'removeHistoryItem':
                    await this.handleRemoveHistoryItem(data.itemId);
                    break;
                case 'getSlashCommands':
                    this.handleGetSlashCommands(data.query);
                    break;
                case 'runCommand':
                    this.handleRunCommand(data.commandName);
                    break;
                case 'nativeSearch':
                    await vscode.commands.executeCommand('workbench.action.findInFiles', {
                        query: data.query ?? '',
                        triggerSearch: true,
                    });
                    break;
                case 'rebuildIndex':
                    vscode.commands.executeCommand('deeplens.rebuildIndex');
                    break;
                case 'clearCache':
                    vscode.commands.executeCommand('deeplens.clearIndexCache');
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'deeplens');
                    break;
            }
        });

        webviewView.webview.postMessage({
            type: 'capabilities',
            textSearchEnabled: this.textSearchEnabled,
        });
    }

    private searchTimeout?: NodeJS.Timeout;
    private searchService: SearchService;
    private lastProcessedRequestId = 0;

    private async handleSearch(query: string, scope: SearchScope) {
        this.currentScope = scope;
        this.lastQuery = query;
        const requestId = ++this.lastRequestId;

        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        if (!query.trim()) {
            await this.handleShowRecentHistory();
            return;
        }

        this.searchTimeout = setTimeout(async () => {
            try {
                const results = await this.searchService.search(query, scope);
                this.lastProcessedRequestId = requestId;
                this._view?.webview.postMessage({ type: 'results', results, requestId, isRecentHistory: false });
            } catch (error) {
                logger.error('DeepLens search view search failed', error);
                this.lastProcessedRequestId = requestId;
                this._view?.webview.postMessage({
                    type: 'results',
                    results: [],
                    requestId,
                    isRecentHistory: false,
                });
            }
        }, 150);
    }

    private async handleOpen(result: SearchResult, preview: boolean) {
        const item = result.item;
        try {
            await this.searchService.navigateToFile(item, vscode.ViewColumn.Active, preview, result.highlights);

            if (!preview) {
                this.recordActivity(result);
            }
        } catch (error) {
            logger.error(`Failed to open file from DeepLens search view: ${item.filePath}`, error);
            vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
        }
    }

    private async handleOpenSide(result: SearchResult) {
        const item = result.item;
        try {
            await this.searchService.navigateToFile(item, vscode.ViewColumn.Beside, true, result.highlights);

            // Preview mode should not record activity (consistent with handleOpen)
        } catch (error) {
            logger.error(`Failed to open side file from DeepLens search view: ${item.filePath}`, error);
            vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
        }
    }

    private async handleReveal(result: SearchResult) {
        const item = result.item;
        try {
            const uri = vscode.Uri.file(item.filePath);
            vscode.commands.executeCommand('revealInExplorer', uri);
        } catch (error) {
            logger.error(`Failed to reveal file from DeepLens search view: ${item.filePath}`, error);
        }
    }

    private async handleCopyPath(result: SearchResult) {
        const item = result.item;
        try {
            await vscode.env.clipboard.writeText(item.filePath);
            this._view?.webview.postMessage({ type: 'status', message: 'Path copied to clipboard' });
        } catch (error) {
            logger.error('Failed to copy path', error);
        }
    }

    private async handleCopyReference(result: SearchResult) {
        const item = result.item;
        try {
            const ref = item.containerName ? `${item.containerName}.${item.name}` : item.name;
            await vscode.env.clipboard.writeText(ref);
            this._view?.webview.postMessage({ type: 'status', message: 'Reference copied to clipboard' });
        } catch (error) {
            logger.error('Failed to copy reference', error);
        }
    }

    private async handleCopyRelativePath(result: SearchResult) {
        const item = result.item;
        try {
            const relativePath = vscode.workspace.asRelativePath(item.filePath);
            await vscode.env.clipboard.writeText(relativePath);
            this._view?.webview.postMessage({ type: 'status', message: 'Relative path copied to clipboard' });
        } catch (error) {
            logger.error('Failed to copy relative path', error);
        }
    }

    private async handleShowRecentHistory() {
        try {
            const results = await this.searchService.getRecentItems(20);
            this._view?.webview.postMessage({
                type: 'results',
                results,
                requestId: ++this.lastRequestId,
                isRecentHistory: true,
            });
        } catch (error) {
            logger.error('Failed to fetch recent items', error);
        }
    }

    private async handleClearHistory() {
        try {
            await this.searchService.clearHistory();
            if (this.activityTracker) {
                await this.activityTracker.clearAll();
            }
            this._view?.webview.postMessage({ type: 'status', message: 'Recent history cleared' });
            await this.handleShowRecentHistory();
        } catch (error) {
            logger.error('Failed to clear history', error);
        }
    }

    private async handleRemoveHistoryItem(itemId: string) {
        try {
            await this.searchService.removeHistoryItem(itemId);
            if (this.activityTracker) {
                await this.activityTracker.removeItem(itemId);
            }
            this._view?.webview.postMessage({ type: 'status', message: 'Item removed from history' });
            await this.handleShowRecentHistory();
        } catch (error) {
            logger.error('Failed to remove history item', error);
        }
    }

    private handleGetSlashCommands(query: string) {
        try {
            const commands = this.getSlashCommandsForQuery(query || undefined);
            this._view?.webview.postMessage({ type: 'slashCommands', commands });
        } catch (error) {
            logger.error('Failed to fetch slash commands', error);
            this._view?.webview.postMessage({ type: 'slashCommands', commands: [] });
        }
    }

    private getSlashCommandsForQuery(query?: string): Array<SlashCommand & { recent?: boolean }> {
        const commands = this.slashCommandService.getCommands(query);
        const recentCommands = this.slashCommandService.getRecentCommands();
        const merged: Array<SlashCommand & { recent?: boolean }> = [];
        const seen = new Set<string>();
        const queryLower = query ? query.toLowerCase() : '';

        for (const cmd of recentCommands) {
            if (seen.has(cmd.name)) {
                continue;
            }
            if (
                queryLower &&
                !cmd.name.toLowerCase().startsWith(queryLower) &&
                !cmd.aliases.some((a) => a.toLowerCase().startsWith(queryLower))
            ) {
                continue;
            }
            merged.push({ ...cmd, recent: true });
            seen.add(cmd.name);
        }

        for (const cmd of commands) {
            if (seen.has(cmd.name)) {
                continue;
            }
            merged.push({ ...cmd, recent: false });
            seen.add(cmd.name);
        }

        return merged;
    }

    private handleRunCommand(commandName: string) {
        try {
            this.slashCommandService.executeCommand(commandName);
            this._view?.webview.postMessage({ type: 'status', message: 'Command executed: ' + commandName });
        } catch (error) {
            logger.error('Failed to run command', error);
        }
    }

    public disableTextSearch(): void {
        this.textSearchEnabled = false;
        this._view?.webview.postMessage({
            type: 'capabilities',
            textSearchEnabled: false,
        });
    }

    private recordActivity(result: SearchResult) {
        if (this.config.isActivityTrackingEnabled()) {
            this.searchService.recordActivity(result.item, false);
            if (this.activityTracker) {
                this.activityTracker.recordAccess(result.item);
            }
        }
    }

    private getSlashCommandScopesJson(): string {
        const map: Record<string, { scope: string }> = {};
        const commands = this.slashCommandService.getCommands();
        for (const cmd of commands) {
            if (cmd.scope == null) continue;
            const scopeStr = cmd.scope.toString().toLowerCase();
            const entry = { scope: scopeStr };
            map[cmd.name.toLowerCase()] = entry;
            for (const alias of cmd.aliases) {
                map[alias.toLowerCase()] = entry;
            }
        }
        return JSON.stringify(map);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = this.getNonce();
        // Read codicon CSS directly from node_modules and embed it
        // This avoids issues with font loading in webviews
        let codiconTtfPath: vscode.Uri;
        let codiconCss = '';
        try {
            codiconTtfPath = vscode.Uri.joinPath(
                this.context.extensionUri,
                'node_modules',
                '@vscode',
                'codicons',
                'dist',
                'codicon.ttf',
            );
            const codiconCssPath = vscode.Uri.joinPath(
                this.context.extensionUri,
                'node_modules',
                '@vscode',
                'codicons',
                'dist',
                'codicon.css',
            );
            codiconCss = fs.readFileSync(codiconCssPath.fsPath, 'utf-8');
            // Replace the relative font path with a proper webview URI
            const fontUrl = webview.asWebviewUri(codiconTtfPath).toString();
            codiconCss = codiconCss.replace('url("./codicon.ttf?', `url("${fontUrl}?`);
        } catch (e) {
            console.error('Failed to load codicon CSS from node_modules, trying dist fallback:', e);
            // Fallback to bundled codicons in dist (used in packaged extension)
            try {
                codiconTtfPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'codicons', 'codicon.ttf');
                const codiconCssFallbackPath = vscode.Uri.joinPath(
                    this.context.extensionUri,
                    'dist',
                    'codicons',
                    'codicon.css',
                );
                codiconCss = fs.readFileSync(codiconCssFallbackPath.fsPath, 'utf-8');
                const fontUrl = webview.asWebviewUri(codiconTtfPath).toString();
                codiconCss = codiconCss.replace('url("./codicon.ttf?', `url("${fontUrl}?`);
            } catch (e2) {
                console.error('Failed to load codicon CSS from dist fallback:', e2);
            }
        }

        const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath.replace(/\\/g, '/'));
        const workspaceFoldersJson = JSON.stringify(workspaceFolders);
        const slashCommandScopesJson = this.getSlashCommandScopesJson();

        // Read HTML file from source directory during development, dist for production
        let htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webviews', 'search-view.html');
        if (!fs.existsSync(htmlPath.fsPath)) {
            htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webviews', 'search-view.html');
        }
        let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

        // Replace placeholders
        html = html.replace(/\${webview.cspSource}/g, webview.cspSource);
        html = html.replace(/\${nonce}/g, nonce);
        html = html.replace(/\${codiconTtfUri}/g, webview.asWebviewUri(codiconTtfPath).toString());
        // Embed codicon CSS
        html = html.replace('</style>', `  ${codiconCss}</style>`);
        // Escape backslashes in JSON strings to prevent regex interpretation
        const escapedSlashCommandScopes = slashCommandScopesJson.replace(/\\/g, '\\\\');
        html = html.replace(/\${SLASH_COMMAND_SCOPES}/g, escapedSlashCommandScopes);
        html = html.replace(/\${WORKSPACE_FOLDERS}/g, workspaceFoldersJson);

        return html;
    }

    private getNonce() {
        return crypto.randomBytes(16).toString('base64url');
    }
}
