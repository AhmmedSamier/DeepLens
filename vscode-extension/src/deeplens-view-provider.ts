import * as vscode from 'vscode';
import { Config } from '../../language-server/src/core/config';
import {
    SearchOptions,
    SearchResult,
    SearchScope,
} from '../../language-server/src/core/types';
import { DeepLensLspClient } from './lsp-client';
import { ActivityTracker } from '../../language-server/src/core/activity-tracker';

export class DeepLensViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = 'deeplens.searchView';
    private _view?: vscode.WebviewView;
    private currentScope: SearchScope = SearchScope.EVERYTHING;
    private lastQuery = '';
    private lastRequestId = 0;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly lspClient: DeepLensLspClient,
        private readonly config: Config,
        private readonly activityTracker?: ActivityTracker,
    ) {}

    public dispose() {
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: vscode.WebviewViewResolveContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            }
        });
    }

    private searchTimeout?: NodeJS.Timeout;

    private async handleSearch(query: string, scope: SearchScope) {
        this.currentScope = scope;
        this.lastQuery = query;
        const requestId = ++this.lastRequestId;

        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        if (!query.trim()) {
            this._view?.webview.postMessage({ type: 'results', results: [], requestId });
            return;
        }

        this.searchTimeout = setTimeout(async () => {
            const options: SearchOptions = {
                query: query.trim(),
                scope: scope,
                maxResults: this.config.getMaxResults(),
            };

            try {
                const results = await this.lspClient.search(options);
                if (requestId === this.lastRequestId) {
                    this._view?.webview.postMessage({ type: 'results', results, requestId });
                }
            } catch (error) {
                console.error('Search failed:', error);
                if (requestId === this.lastRequestId) {
                    this._view?.webview.postMessage({ type: 'results', results: [], requestId });
                }
            }
        }, 150);
    }

    private async handleOpen(result: SearchResult, preview: boolean) {
        const item = result.item;
        try {
            const uri = vscode.Uri.file(item.filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const position = new vscode.Position(item.line || 0, item.column || 0);

            await vscode.window.showTextDocument(document, {
                selection: new vscode.Range(position, position),
                preview: preview,
                preserveFocus: preview,
            });

            if (!preview) {
                this.recordActivity(result);
            }
        } catch {
            vscode.window.showErrorMessage(`Failed to open file: ${item.filePath}`);
        }
    }

    private recordActivity(result: SearchResult) {
        if (this.config.isActivityTrackingEnabled()) {
            this.lspClient.recordActivity(result.item.id);
            if (this.activityTracker) {
                this.activityTracker.recordAccess(result.item);
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DeepLens Search</title>
    <style nonce="${nonce}">
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
        .scope-button {
            padding: 2px 6px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid transparent;
            border-radius: 2px;
            cursor: pointer;
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
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .result-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .result-item.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .result-name {
            font-weight: bold;
            font-size: 13px;
        }
        .result-detail {
            font-size: 11px;
            opacity: 0.7;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .result-path {
            font-size: 11px;
            opacity: 0.5;
        }
    </style>
</head>
<body>
    <div class="search-container">
        <div class="scope-buttons">
            <button class="scope-button active" data-scope="everything" title="Search Everything">All</button>
            <button class="scope-button" data-scope="files" title="Search Files">Files</button>
            <button class="scope-button" data-scope="types" title="Search Classes & Interfaces">Classes</button>
            <button class="scope-button" data-scope="symbols" title="Search Methods & Functions">Symbols</button>
            <button class="scope-button" data-scope="text" title="Search Text Content">Text</button>
            <button class="scope-button" data-scope="open" title="Search Open Files">Open</button>
            <button class="scope-button" data-scope="modified" title="Search Modified Files">Modified</button>
        </div>
        <input type="text" id="search-input" placeholder="Search everywhere..." autocomplete="off">
    </div>
    <div id="results" class="results-container"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const searchInput = document.getElementById('search-input');
        const resultsContainer = document.getElementById('results');
        const scopeButtons = document.querySelectorAll('.scope-button');

        let currentScope = 'everything';
        let results = [];
        let selectedIndex = -1;

        searchInput.addEventListener('input', (e) => {
            vscode.postMessage({
                type: 'search',
                query: e.target.value,
                scope: currentScope
            });
        });

        scopeButtons.forEach(button => {
            button.addEventListener('click', () => {
                scopeButtons.forEach(b => b.classList.remove('active'));
                button.classList.add('active');
                currentScope = button.getAttribute('data-scope');
                vscode.postMessage({
                    type: 'search',
                    query: searchInput.value,
                    scope: currentScope
                });
            });
        });

        let lastRenderedRequestId = 0;

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'results':
                    if (message.requestId >= lastRenderedRequestId) {
                        lastRenderedRequestId = message.requestId;
                        results = message.results;
                        renderResults();
                    }
                    break;
            }
        });

        function renderResults() {
            resultsContainer.innerHTML = '';
            selectedIndex = -1;

            results.forEach((result, index) => {
                const item = result.item;
                const div = document.createElement('div');
                div.className = 'result-item';
                div.innerHTML = \`
                    <div class="result-name">\${escapeHtml(item.name)}</div>
                    <div class="result-detail">\${escapeHtml(item.detail || '')}</div>
                    <div class="result-path">\${escapeHtml(item.filePath)}</div>
                \`;

                div.addEventListener('click', () => {
                    selectItem(index);
                    vscode.postMessage({ type: 'preview', result });
                });

                div.addEventListener('dblclick', () => {
                    vscode.postMessage({ type: 'open', result });
                });

                resultsContainer.appendChild(div);
            });
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

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectItem(Math.min(selectedIndex + 1, results.length - 1));
                if (selectedIndex >= 0) {
                    vscode.postMessage({ type: 'preview', result: results[selectedIndex] });
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectItem(Math.max(selectedIndex - 1, 0));
                if (selectedIndex >= 0) {
                    vscode.postMessage({ type: 'preview', result: results[selectedIndex] });
                }
            } else if (e.key === 'Enter') {
                if (selectedIndex >= 0) {
                    vscode.postMessage({ type: 'open', result: results[selectedIndex] });
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
    </script>
</body>
</html>`;
    }

    private getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            // eslint-disable-next-line sonarjs/pseudo-random
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
