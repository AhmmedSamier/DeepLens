import * as vscode from 'vscode';
import { Config } from '../../language-server/src/core/config';
import { SearchOptions, SearchResult, SearchScope } from '../../language-server/src/core/types';
import { CommandIndexer } from './command-indexer';
import { DeepLensLspClient } from './lsp-client';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';
import { logger } from './services/logging-service';
import { SlashCommand, SlashCommandCategory, SlashCommandService } from './slash-command-service';
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
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
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
            const options: SearchOptions = {
                query: query.trim(),
                scope: scope,
                maxResults: this.config.getMaxResults(),
            };

            try {
                const results = await this.searchService.search(query, scope);
                if (requestId === this.lastRequestId) {
                    this._view?.webview.postMessage({ type: 'results', results, requestId, isRecentHistory: false });
                }
            } catch (error) {
                logger.error('DeepLens search view search failed', error);
                if (requestId === this.lastRequestId) {
                    this._view?.webview.postMessage({
                        type: 'results',
                        results: [],
                        requestId,
                        isRecentHistory: false,
                    });
                }
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

            this.recordActivity(result);
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
        const codiconTtfUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'codicons', 'codicon.ttf'),
        );
        const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath.replace(/\\/g, '/'));
        const workspaceFoldersJson = JSON.stringify(workspaceFolders);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">
        @font-face {
            font-family: "codicon";
            font-display: block;
            src: url("${codiconTtfUri}") format("truetype");
        }
        .codicon[class*='codicon-'] {
            font: normal normal normal 16px/1 codicon;
            display: inline-block;
            text-decoration: none;
            text-rendering: auto;
            text-align: center;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            user-select: none;
            -webkit-user-select: none;
            -ms-user-select: none;
        }
        .codicon-search:before { content: "\\ea6d" }
        .codicon-file:before { content: "\\ea7b" }
        .codicon-symbol-class:before { content: "\\eb5b" }
        .codicon-symbol-method:before { content: "\\ea8c" }
        .codicon-whole-word:before { content: "\\eb7e" }
        .codicon-book:before { content: "\\eaa4" }
        .codicon-git-merge:before { content: "\\eafe" }
        .codicon-run:before { content: "\\eb2c" }
        .codicon-symbol-property:before { content: "\\eb65" }
        .codicon-globe:before { content: "\\eb01" }
        .codicon-stop-circle:before { content: "\\eba5" }
        .codicon-copy:before { content: "\\ebcc" }
        .codicon-history:before { content: "\\ea82" }
        .codicon-light-bulb:before { content: "\\ea61" }
        .codicon-search-fuzzy:before { content: "\\ec0d" }
        .codicon-refresh:before { content: "\\eb37" }
        .codicon-trash:before { content: "\\ea81" }
        .codicon-clear-all:before { content: "\\eb2f" }
        .codicon-settings-gear:before { content: "\\eb51" }
        .codicon-split-horizontal:before { content: "\\eb56" }
        .codicon-folder-opened:before { content: "\\eaf7" }
        .codicon-references:before { content: "\\eb1e" }
        .codicon-file-submodule:before { content: "\\eafd" }
        body {
            padding: 10px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
        }
        .search-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
        }
        input {
            width: 100%;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .scope-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .search-controls {
            display: flex;
            gap: 4px;
        }
        .search-summary {
            margin-top: 4px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            min-height: 16px;
        }
        .pro-tip {
            padding: 8px;
            background: var(--vscode-input-background);
            border-radius: 3px;
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .pro-tip-icon {
            color: var(--vscode-textLink-foreground);
            font-size: 14px;
        }
        .empty-state {
            padding: 10px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .empty-state-actions {
            margin-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .empty-state-btn {
            padding: 8px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid transparent;
            border-radius: 2px;
            cursor: pointer;
            text-align: left;
        }
        .empty-state-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .scope-button {
            padding: 2px 6px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid transparent;
            border-radius: 2px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .scope-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .scope-button.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .scope-button.active:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .results-container {
            display: flex;
            flex-direction: column;
        }
        .result-item {
            padding: 1px 8px 1px 4px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            justify-content: center;
            position: relative;
            min-height: 22px;
            box-sizing: border-box;
        }
        .result-item:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-list-hoverForeground);
        }
        .result-item.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
            outline: 1px solid var(--vscode-list-focusOutline, transparent);
            outline-offset: -1px;
        }
        .result-item:hover .result-actions,
        .result-item.selected .result-actions {
            display: flex;
        }
        .result-row {
            display: flex;
            align-items: center;
            gap: 5px;
            overflow: hidden;
            line-height: 22px;
            height: 22px;
        }
        .result-icon {
            flex-shrink: 0;
            width: 16px;
            height: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            margin-left: 2px;
            opacity: 0.8;
        }
        .result-label {
            flex: 1;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }
        .result-desc {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex-shrink: 1;
            min-width: 0;
            max-width: 45%;
            padding-right: 4px;
        }
        .result-item.selected .result-desc {
            color: var(--vscode-list-activeSelectionForeground);
            opacity: 0.8;
        }
        .result-match {
            font-weight: 600;
            color: var(--vscode-list-highlightForeground);
        }
        .result-item.selected .result-match {
            color: var(--vscode-list-activeSelectionForeground);
            text-decoration: underline;
        }
        .result-detail {
            display: flex;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.65;
            white-space: nowrap;
            overflow: hidden;
            padding-left: 23px;
            line-height: 16px;
            padding-bottom: 2px;
        }
        .result-detail-dir {
            overflow: hidden;
            text-overflow: ellipsis;
            direction: rtl;
            unicode-bidi: bidi-override;
            text-align: left;
            flex-shrink: 1;
            min-width: 0;
        }
        .result-detail-file {
            flex-shrink: 0;
            white-space: nowrap;
        }
        .recent-badge {
            font-size: 10px;
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 1px 6px;
            border-radius: 8px;
            margin-left: 6px;
            flex-shrink: 0;
        }
        .result-actions {
            display: none;
            align-items: center;
            gap: 2px;
            margin-left: auto;
            flex-shrink: 0;
        }
        .result-action-btn {
            border: none;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 1px 4px;
            border-radius: 2px;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .result-action-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
            color: var(--vscode-foreground);
        }
        .codicon {
            display: inline-block;
            margin-right: 3px;
        }
    </style>
</head>
<body>
    <div class="search-container">
        <div class="scope-buttons" id="scope-buttons">
            <button class="scope-button active" data-scope="everything" title="Search Everything"><i class="codicon codicon-search"></i> All</button>
            <button class="scope-button" data-scope="files" title="Search Files"><i class="codicon codicon-file"></i> Files</button>
            <button class="scope-button" data-scope="types" title="Search Classes &amp; Interfaces"><i class="codicon codicon-symbol-class"></i> Classes</button>
            <button class="scope-button" data-scope="symbols" title="Search Methods &amp; Functions"><i class="codicon codicon-symbol-method"></i> Symbols</button>
            <button class="scope-button" data-scope="text" title="Search Text Content"><i class="codicon codicon-whole-word"></i> Text</button>
            <button class="scope-button" data-scope="open" title="Search Open Files"><i class="codicon codicon-book"></i> Open</button>
            <button class="scope-button" data-scope="modified" title="Search Modified Files"><i class="codicon codicon-git-merge"></i> Modified</button>
            <button class="scope-button" data-scope="commands" title="Run VS Code Commands"><i class="codicon codicon-run"></i> Commands</button>
            <button class="scope-button" data-scope="properties" title="Search Properties"><i class="codicon codicon-symbol-property"></i> Properties</button>
            <button class="scope-button" data-scope="endpoints" title="Search API Endpoints"><i class="codicon codicon-globe"></i> Endpoints</button>
        </div>
        <input type="text" id="search-input" placeholder="Search everywhere..." autocomplete="off">

        <div id="search-summary" class="search-summary"></div>
    </div>
    <div id="results" class="results-container"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('search-input');
        const resultsContainer = document.getElementById('results');
        const scopeButtons = document.querySelectorAll('.scope-button');
        const summaryEl = document.getElementById('search-summary');

        let currentScope = 'everything';
        let userScope = 'everything';
        let results = [];
        let slashCommands = [];
        let visibleEntries = [];
        let selectedIndex = -1;
        let textSearchEnabled = true;
        let recentHistoryMode = false;
        let confirmClearHistory = false;

        const slashCommandScopes = ${this.getSlashCommandScopesJson()};

        function isSlashTriggerQuery(rawQuery) {
            const trimmed = rawQuery.trimStart();
            return trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('>');
        }

        function setTextSearchEnabled(enabled) {
            textSearchEnabled = enabled;
            scopeButtons.forEach((button) => {
                if (button.getAttribute('data-scope') !== 'text') {
                    return;
                }
                button.disabled = !enabled;
                button.style.opacity = enabled ? '1' : '0.5';
                button.title = enabled ? 'Search Text Content' : 'Text search unavailable (ripgrep missing)';
            });

            if (!enabled && currentScope === 'text') {
                currentScope = 'everything';
                userScope = 'everything';
                updateScopeButtons();
            }

            updateSummary();
        }

        function resolveQueryAndScope(rawQuery) {
            const trimmed = rawQuery.trimStart();
            // Match a prefix token: starts with /, #, or >
            const m = trimmed.match(/^(\\/\\S*|#|>)(?:\\s|$)/);
            if (m) {
                const prefix = m[1].toLowerCase();
                const scopeEntry = slashCommandScopes[prefix];
                if (scopeEntry) {
                    return { scope: scopeEntry.scope, detectedScope: scopeEntry.scope };
                }
            }
            return { scope: userScope, detectedScope: null };
        }

        function stripLeadingScopeToken(rawQuery) {
            const trimmed = rawQuery.trimStart();
            return trimmed.replace(/^(\\/\\S*|#|>)(?:\\s*)/, '');
        }

        function setActiveScopeButton(scope) {
            scopeButtons.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-scope') === scope);
            });
        }

        function updateScopeButtons() {
            setActiveScopeButton(currentScope);
            updateSummary();
        }

        function getScopeLabel(scope) {
            const labels = {
                everything: 'Everything',
                open: 'Open Files',
                modified: 'Modified Files',
                types: 'Classes',
                symbols: 'Symbols',
                files: 'Files',
                text: 'Text',
                commands: 'Commands',
                properties: 'Properties',
                endpoints: 'Endpoints',
            };
            return labels[scope] || 'Everything';
        }

        function updateSummary(customText) {
            if (!summaryEl) {
                return;
            }

            if (customText) {
                summaryEl.textContent = customText;
                return;
            }

            const scopeLabel = getScopeLabel(currentScope);
            if (recentHistoryMode) {
                summaryEl.textContent = 'Recent History (' + results.length + ')';
                return;
            }

            if (isSlashTriggerQuery(searchInput.value) && slashCommands.length > 0) {
                const recentCount = slashCommands.filter((cmd) => cmd.recent).length;
                const recentSuffix = recentCount > 0 ? ', ' + recentCount + ' recent' : '';
                summaryEl.textContent = scopeLabel + ': ' + slashCommands.length + ' slash commands' + recentSuffix;
                return;
            }

            summaryEl.textContent = scopeLabel + ': ' + results.length + ' results';
        }

        function triggerSearchFromInput(raw) {
            const { scope, detectedScope } = resolveQueryAndScope(raw);
            let effectiveQuery = raw;

            if (detectedScope && detectedScope !== currentScope) {
                currentScope = detectedScope;
                setActiveScopeButton(currentScope);

                effectiveQuery = stripLeadingScopeToken(raw);
                if (searchInput.value !== effectiveQuery) {
                    searchInput.value = effectiveQuery;
                }
            } else if (!detectedScope && userScope !== currentScope) {
                currentScope = userScope;
                setActiveScopeButton(currentScope);
            }

            if (isSlashTriggerQuery(effectiveQuery)) {
                vscode.postMessage({ type: 'getSlashCommands', query: effectiveQuery });
            } else {
                slashCommands = [];
            }

            vscode.postMessage({ type: 'search', query: effectiveQuery, scope: currentScope });
        }

        searchInput.addEventListener('input', (e) => {
            triggerSearchFromInput(e.target.value);
        });

        scopeButtons.forEach(button => {
            button.addEventListener('click', () => {
                const newScope = button.getAttribute('data-scope');
                if (!textSearchEnabled && newScope === 'text') {
                    return;
                }
                if (currentScope !== newScope) {
                    currentScope = newScope;
                    userScope = newScope;
                    const strippedQuery = stripLeadingScopeToken(searchInput.value);
                    if (searchInput.value !== strippedQuery) {
                        searchInput.value = strippedQuery;
                    }
                    setActiveScopeButton(currentScope);
                    vscode.postMessage({
                        type: 'search',
                        query: strippedQuery,
                        scope: currentScope
                    });
                }
            });
        });

        updateScopeButtons();

        let lastRenderedRequestId = 0;

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'results':
                    if (message.requestId >= lastRenderedRequestId) {
                        lastRenderedRequestId = message.requestId;
                        results = message.results;
                        recentHistoryMode = message.isRecentHistory === true;
                        if (!recentHistoryMode) {
                            confirmClearHistory = false;
                        }
                        renderResults();
                    }
                    break;
                case 'status':
                    showStatus(message.message);
                    updateSummary(message.message);
                    break;
                case 'slashCommands':
                    slashCommands = message.commands || [];
                    renderResults();
                    break;
                case 'capabilities':
                    setTextSearchEnabled(message.textSearchEnabled !== false);
                    break;
            }
        });

        function showStatus(message) {
            const existing = document.querySelector('.status-message');
            if (existing) {
                existing.remove();
            }
            const statusEl = document.createElement('div');
            statusEl.className = 'status-message';
            statusEl.textContent = message;
            statusEl.style.cssText = 'padding: 8px; background: var(--vscode-banner-background); color: var(--vscode-banner-foreground); border-radius: 3px; display: flex; align-items: center; gap: 8px; margin-bottom: 12px;';
            resultsContainer.parentNode.insertBefore(statusEl, resultsContainer);
            setTimeout(() => statusEl.remove(), 2000);
        }

        function renderResults() {
            resultsContainer.innerHTML = '';
            selectedIndex = -1;
            visibleEntries = [];

            const showSlashCommands = isSlashTriggerQuery(searchInput.value) && slashCommands.length > 0;
            if (showSlashCommands) {
                renderSlashCommands();
                updateSummary();
                return;
            }

            if (results.length === 0) {
                renderEmptyState();
                updateSummary();
                return;
            }

            if (recentHistoryMode) {
                renderHistoryToolbar();
            }

            if (results.length === 0 && searchInput.value.trim() !== '') {
                const emptyDiv = document.createElement('div');
                emptyDiv.style.padding = '20px 10px';
                emptyDiv.style.textAlign = 'center';
                emptyDiv.style.color = 'var(--vscode-descriptionForeground)';

                const messageDiv = document.createElement('div');
                messageDiv.style.marginBottom = '12px';
                messageDiv.textContent = \`No results found for '\${searchInput.value}'\`;

                const clearBtn = document.createElement('button');
                clearBtn.className = 'scope-button';
                clearBtn.style.padding = '4px 12px';
                clearBtn.style.fontSize = '12px';
                clearBtn.textContent = 'Clear Search';

                emptyDiv.appendChild(messageDiv);
                emptyDiv.appendChild(clearBtn);

                resultsContainer.appendChild(emptyDiv);

                clearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    currentScope = 'everything';
                    scopeButtons.forEach(b => {
                        b.classList.remove('active');
                        if (b.getAttribute('data-scope') === 'everything') {
                            b.classList.add('active');
                        }
                    });
                    vscode.postMessage({
                        type: 'search',
                        query: '',
                        scope: 'everything'
                    });
                });
                return;
            }

            results.forEach((result, index) => {
                const item = result.item;
                const div = document.createElement('div');
                div.className = 'result-item';

                // Get icon for item type
                const iconClass = getIconForItemType(item.type);
                const iconHtml = iconClass ? \`<i class="codicon codicon-\${iconClass} result-icon"></i>\` : '<span class="result-icon"></span>';

                // Highlighted label using match positions
                const labelHtml = renderHighlightedLabel(item.name, result.highlights);

                // Description (container name) shown to the right of label on same row
                const descHtml = item.containerName
                    ? \`<span class="result-desc">\${escapeHtml(item.containerName)}</span>\`
                    : '';

                // Detail: split into dir (truncate-left) + basename:line (stable right)
                let detailHtml = '';
                if (item.type !== 'command' && item.filePath) {
                    const relativePath = getRelativePath(item.filePath);
                    const slashIdx = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\\\'));
                    const dir = slashIdx >= 0 ? relativePath.slice(0, slashIdx + 1) : '';
                    const base = slashIdx >= 0 ? relativePath.slice(slashIdx + 1) : relativePath;
                    const lineInfo = item.line !== undefined ? \`:\${item.line + 1}\` : '';
                    const dirHtml = dir ? \`<span class="result-detail-dir">\${escapeHtml(dir)}</span>\` : '';
                    detailHtml = \`<div class="result-detail">\${dirHtml}<span class="result-detail-file">\${escapeHtml(base + lineInfo)}</span></div>\`;
                }

                const actionsHtml = renderResultActions(item);

                div.innerHTML = \`
                    <div class="result-row">
                        \${iconHtml}
                        <span class="result-label">\${labelHtml}</span>
                        \${descHtml}
                        \${actionsHtml}
                    </div>
                    \${detailHtml}
                \`;

                div.addEventListener('click', () => {
                    selectItem(index);
                    vscode.postMessage({ type: 'preview', result });
                });

                div.addEventListener('dblclick', () => {
                    vscode.postMessage({ type: 'open', result });
                });

                div.querySelectorAll('.result-action-btn').forEach((button) => {
                    button.addEventListener('click', (event) => {
                        event.stopPropagation();
                        const action = button.getAttribute('data-action');
                        if (action) {
                            if (action === 'removeHistory') {
                                vscode.postMessage({ type: 'removeHistoryItem', itemId: result.item.id });
                                return;
                            }
                            vscode.postMessage({ type: action, result });
                        }
                    });
                });

                resultsContainer.appendChild(div);
                visibleEntries.push({ kind: 'result', result });
            });

            updateSummary();
        }

        function renderSlashCommands() {
            slashCommands.forEach((command, index) => {
                const div = document.createElement('div');
                div.className = 'result-item';

                const icon = command.icon || 'run';
                const label = escapeHtml(command.name || command.id || '/command');
                const description = command.description ? \`<span class="result-desc">\${escapeHtml(command.description)}</span>\` : '';
                const detail = command.example
                    ? \`<div class="result-detail"><span class="result-detail-file">Try: \${escapeHtml(command.example)}</span></div>\`
                    : '';
                const recentBadge = command.recent ? '<span class="recent-badge">Recent</span>' : '';

                div.innerHTML = \`
                    <div class="result-row">
                        <i class="codicon codicon-\${icon} result-icon"></i>
                        <span class="result-label">\${label}</span>
                        \${description}
                        \${recentBadge}
                    </div>
                    \${detail}
                \`;

                div.addEventListener('click', () => {
                    selectItem(index);
                });

                div.addEventListener('dblclick', () => {
                    vscode.postMessage({ type: 'runCommand', commandName: command.name });
                });

                resultsContainer.appendChild(div);
                visibleEntries.push({ kind: 'slash', command });
            });

            updateSummary();
        }

        function renderEmptyState() {
            const escaped = escapeHtml(searchInput.value);
            const switchScope = currentScope !== 'everything'
                ? '<button class="empty-state-btn" data-empty-action="global"><i class="codicon codicon-search"></i> Switch to Global Search</button>'
                : '';

            resultsContainer.innerHTML = \`
                <div class="empty-state">No results found for '\${escaped}'.</div>
                <div class="empty-state-actions">
                    <button class="empty-state-btn" data-empty-action="clear"><i class="codicon codicon-clear-all"></i> Clear Search</button>
                    <button class="empty-state-btn" data-empty-action="recent"><i class="codicon codicon-history"></i> Show Recent History</button>
                    \${switchScope}
                    <button class="empty-state-btn" data-empty-action="native"><i class="codicon codicon-search-fuzzy"></i> Search in Files (Native)</button>
                    <button class="empty-state-btn" data-empty-action="rebuild"><i class="codicon codicon-refresh"></i> Rebuild Index</button>
                    <button class="empty-state-btn" data-empty-action="clear-cache"><i class="codicon codicon-trash"></i> Clear Index Cache</button>
                    <button class="empty-state-btn" data-empty-action="settings"><i class="codicon codicon-settings-gear"></i> Configure Settings</button>
                </div>
            \`;

            resultsContainer.querySelectorAll('[data-empty-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    const action = button.getAttribute('data-empty-action');
                    if (action === 'clear') {
                        searchInput.value = '';
                        triggerSearchFromInput('');
                        searchInput.focus();
                        return;
                    }
                    if (action === 'recent') {
                        vscode.postMessage({ type: 'showRecentHistory' });
                        return;
                    }
                    if (action === 'global') {
                        switchToGlobal();
                        return;
                    }
                    if (action === 'native') {
                        copyNativeSearch();
                        return;
                    }
                    if (action === 'rebuild') {
                        rebuildIndex();
                        return;
                    }
                    if (action === 'clear-cache') {
                        vscode.postMessage({ type: 'clearCache' });
                        showStatus('Clearing index cache...');
                        return;
                    }
                    if (action === 'settings') {
                        vscode.postMessage({ type: 'openSettings' });
                    }
                });
            });
        }

        function renderHistoryToolbar() {
            const toolbar = document.createElement('div');
            toolbar.className = 'empty-state-actions';

            if (confirmClearHistory) {
                toolbar.innerHTML = '\
                    <button class="empty-state-btn" data-history-action="confirm-clear"><i class="codicon codicon-trash"></i> Confirm Clear History</button>\
                    <button class="empty-state-btn" data-history-action="cancel-clear"><i class="codicon codicon-clear-all"></i> Cancel</button>\
                ';
            } else {
                toolbar.innerHTML = '\
                    <button class="empty-state-btn" data-history-action="clear"><i class="codicon codicon-trash"></i> Clear Recent History</button>\
                ';
            }

            toolbar.querySelectorAll('[data-history-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    const action = button.getAttribute('data-history-action');
                    if (action === 'clear') {
                        confirmClearHistory = true;
                        renderResults();
                        return;
                    }
                    if (action === 'cancel-clear') {
                        confirmClearHistory = false;
                        renderResults();
                        return;
                    }
                    if (action === 'confirm-clear') {
                        confirmClearHistory = false;
                        vscode.postMessage({ type: 'clearHistory' });
                    }
                });
            });

            resultsContainer.appendChild(toolbar);
            updateSummary();
        }

        function renderResultActions(item) {
            if (item.type === 'command') {
                return '';
            }

            const symbolTypes = new Set(['class', 'interface', 'enum', 'function', 'method', 'property', 'variable']);
            const fileTypes = new Set(['file', 'text']);
            let buttons = '';

            buttons += '<button class="result-action-btn" data-action="copyPath" title="Copy Path"><i class="codicon codicon-copy"></i></button>';

            if (symbolTypes.has(item.type)) {
                buttons += '<button class="result-action-btn" data-action="copyReference" title="Copy Reference"><i class="codicon codicon-references"></i></button>';
            }

            if (fileTypes.has(item.type)) {
                buttons += '<button class="result-action-btn" data-action="copyRelativePath" title="Copy Relative Path"><i class="codicon codicon-file-submodule"></i></button>';
            }

            buttons += '<button class="result-action-btn" data-action="openSide" title="Open to the Side"><i class="codicon codicon-split-horizontal"></i></button>';

            if (fileTypes.has(item.type)) {
                buttons += '<button class="result-action-btn" data-action="reveal" title="Reveal in Explorer"><i class="codicon codicon-folder-opened"></i></button>';
            }

            if (recentHistoryMode) {
                buttons += '<button class="result-action-btn" data-action="removeHistory" title="Remove from History"><i class="codicon codicon-trash"></i></button>';
            }

            return \`<div class="result-actions">\${buttons}</div>\`;
        }

        function renderHighlightedLabel(name, highlights) {
            if (!highlights || highlights.length === 0) return escapeHtml(name);
            // highlights is array of [start, end] pairs (end exclusive)
            const ranges = highlights.slice().sort((a, b) => a[0] - b[0]);
            let result = '';
            let pos = 0;
            for (const [start, end] of ranges) {
                if (start > pos) result += escapeHtml(name.slice(pos, start));
                result += '<b class="result-match">' + escapeHtml(name.slice(start, end)) + '</b>';
                pos = end;
            }
            if (pos < name.length) result += escapeHtml(name.slice(pos));
            return result;
        }

        function getIconForItemType(type) {
            const iconMap = {
                'class': 'symbol-class',
                'interface': 'symbol-interface',
                'enum': 'symbol-enum',
                'function': 'symbol-function',
                'method': 'symbol-method',
                'property': 'symbol-property',
                'variable': 'symbol-variable',
                'file': 'file',
                'text': 'whole-word',
                'command': 'run',
                'endpoint': 'globe',
            };
            return iconMap[type] || 'symbol-misc';
        }

        const workspaceFolders = ${workspaceFoldersJson};

        function getRelativePath(filePath) {
            // Normalize separators to forward slash
            const normalized = filePath.replace(/\\\\/g, '/');
            for (const folder of workspaceFolders) {
                const prefix = folder.endsWith('/') ? folder : folder + '/';
                if (normalized.startsWith(prefix)) {
                    return normalized.slice(prefix.length);
                }
            }
            // Fallback: just return the path as-is (or filename if very long)
            return normalized;
        }

        function selectItem(index) {
            const items = document.querySelectorAll('.result-item');
            if (selectedIndex >= 0) items[selectedIndex].classList.remove('selected');
            selectedIndex = index;
            if (selectedIndex >= 0) {
                items[selectedIndex].classList.add('selected');
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        function getEffectiveSelection(index) {
            if (index < 0 || index >= visibleEntries.length) {
                return null;
            }
            return visibleEntries[index];
        }

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectItem(Math.min(selectedIndex + 1, visibleEntries.length - 1));
                const selection = getEffectiveSelection(selectedIndex);
                if (selection && selection.kind === 'result') {
                    vscode.postMessage({ type: 'preview', result: selection.result });
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectItem(Math.max(selectedIndex - 1, 0));
                const selection = getEffectiveSelection(selectedIndex);
                if (selection && selection.kind === 'result') {
                    vscode.postMessage({ type: 'preview', result: selection.result });
                }
            } else if (e.key === 'Enter') {
                const selection = getEffectiveSelection(selectedIndex);
                if (selection && selection.kind === 'result') {
                    vscode.postMessage({ type: 'open', result: selection.result });
                } else if (selection && selection.kind === 'slash') {
                    vscode.postMessage({ type: 'runCommand', commandName: selection.command.name });
                }
            }
        });

        function escapeHtml(unsafe) {
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function tryTip() {
            const tips = [
                { label: 'Search Symbols', action: '#', desc: 'Find methods & variables' },
                { label: 'Run Commands', action: '> ', desc: 'Execute VS Code commands' },
                { label: 'Find Modified Files', action: '/m ', desc: 'See changed files' },
                { label: 'Search Open Files', action: '/o ', desc: 'Search open tabs' },
                { label: 'Search Types', action: '/t ', desc: 'Find classes & interfaces' },
                { label: 'Search Text', action: '/txt ', desc: 'Search file content' },
                { label: 'Find Endpoints', action: '/e ', desc: 'Search API routes' },
            ];
            const tip = tips[Math.floor(Math.random() * tips.length)];
            searchInput.value = tip.action;
            searchInput.focus();
            showStatus('Pro tip loaded: ' + tip.label + ' (' + tip.desc + ')');
        }

        function switchToGlobal() {
            const text = searchInput.value;
            let stripLen = 0;
            if (text.length > 0 && text[0] === '/') {
                let end = text.indexOf(' ');
                if (end === -1) end = text.length;
                stripLen = end;
            }
            searchInput.value = '/all ' + text.slice(stripLen);
            currentScope = 'everything';
            userScope = 'everything';
            updateScopeButtons();
            vscode.postMessage({
                type: 'search',
                query: searchInput.value,
                scope: currentScope
            });
        }

        function copyNativeSearch() {
            vscode.postMessage({ type: 'nativeSearch', query: searchInput.value });
        }

        function rebuildIndex() {
            vscode.postMessage({ type: 'rebuildIndex' });
            showStatus('Rebuilding index...');
        }

        async function runCommand(commandName) {
            vscode.postMessage({ type: 'runCommand', commandName });
        }

        searchInput.focus();
        triggerSearchFromInput(searchInput.value || '');
        updateSummary();
    </script>
</body>
</html>`;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
