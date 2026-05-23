import * as vscode from 'vscode';
import { SearchScope, SearchResult } from '../../language-server/src/core/types';
import { DeepLensLspClient } from './lsp-client';

interface SearchPanelState {
    query: string;
    scope: SearchScope;
}

export class SearchPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'deeplens.searchPanel';
    private view: vscode.WebviewView | null = null;
    private searchTokenSource: vscode.CancellationTokenSource | null = null;
    private selectedIndex = -1;
    private currentResults: SearchResult[] = [];
    private readonly state: SearchPanelState = {
        query: '',
        scope: SearchScope.EVERYTHING,
    };

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly lspClient: DeepLensLspClient,
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
            const msg = message as { type?: string; query?: string; scope?: string; index?: number };

            if (msg.type === 'ready') {
                this.postState();
                return;
            }

            if (msg.type === 'search') {
                this.state.query = msg.query ?? '';
                this.state.scope = this.parseScope(msg.scope);
                await this.runSearch();
                return;
            }

            if (msg.type === 'preview' && typeof msg.index === 'number') {
                await this.previewResult(msg.index);
                return;
            }

            if (msg.type === 'open' && typeof msg.index === 'number') {
                await this.openResult(msg.index);
            }
        });

        webviewView.onDidDispose(() => {
            this.view = null;
        });
    }

    public async showPanel(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.deeplens');
        await vscode.commands.executeCommand(`${SearchPanelProvider.viewType}.focus`);
    }

    private parseScope(value?: string): SearchScope {
        const allowedScopes = new Set<string>(Object.values(SearchScope));
        if (value && allowedScopes.has(value)) {
            return value as SearchScope;
        }
        return SearchScope.EVERYTHING;
    }

    private async runSearch(): Promise<void> {
        if (!this.view) {
            return;
        }

        this.searchTokenSource?.cancel();
        this.searchTokenSource?.dispose();
        this.searchTokenSource = new vscode.CancellationTokenSource();

        const trimmedQuery = this.state.query.trim();
        if (trimmedQuery.length === 0) {
            this.currentResults = [];
            this.selectedIndex = -1;
            this.postResults();
            return;
        }

        const activeSearchTokenSource = this.searchTokenSource;
        const activeSearchToken = activeSearchTokenSource.token;

        const results = await this.lspClient.burstSearch(
            {
                query: trimmedQuery,
                scope: this.state.scope,
                maxResults: 200,
            },
            activeSearchToken,
        );

        if (this.searchTokenSource !== activeSearchTokenSource || this.searchTokenSource.token !== activeSearchToken) {
            return;
        }

        this.currentResults = results;
        this.selectedIndex = -1;
        this.postResults();
    }

    private async previewResult(index: number): Promise<void> {
        const result = this.currentResults[index];
        if (!result) {
            return;
        }

        this.selectedIndex = index;
        this.postSelection();

        const line = Math.max(0, (result.item.line ?? 1) - 1);
        const column = Math.max(0, (result.item.column ?? 1) - 1);
        const uri = vscode.Uri.file(result.item.filePath);

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            preview: true,
            preserveFocus: true,
            selection: new vscode.Range(line, column, line, column),
        });
    }

    private async openResult(index: number): Promise<void> {
        const result = this.currentResults[index];
        if (!result) {
            return;
        }

        this.selectedIndex = index;
        this.postSelection();

        const line = Math.max(0, (result.item.line ?? 1) - 1);
        const column = Math.max(0, (result.item.column ?? 1) - 1);
        const uri = vscode.Uri.file(result.item.filePath);

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            preview: false,
            preserveFocus: false,
            selection: new vscode.Range(line, column, line, column),
        });

        await this.lspClient.recordActivity(result.item.id);
    }

    private postState(): void {
        this.view?.webview.postMessage({
            type: 'state',
            query: this.state.query,
            scope: this.state.scope,
            scopes: [
                SearchScope.EVERYTHING,
                SearchScope.FILES,
                SearchScope.TYPES,
                SearchScope.SYMBOLS,
                SearchScope.TEXT,
            ],
        });
    }

    private postResults(): void {
        this.view?.webview.postMessage({
            type: 'results',
            results: this.currentResults.map((result) => ({
                title: result.item.name,
                detail: result.item.relativeFilePath ?? result.item.filePath,
                line: result.item.line ?? null,
                type: result.item.type,
                scope: result.scope,
            })),
            selectedIndex: this.selectedIndex,
        });
    }

    private postSelection(): void {
        this.view?.webview.postMessage({ type: 'selection', selectedIndex: this.selectedIndex });
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = Date.now().toString();
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
.toolbar { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
.scope-btn { border:1px solid var(--vscode-button-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius:4px; padding:3px 8px; cursor:pointer; font-size:12px; }
.scope-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
input { width: 100%; box-sizing:border-box; padding:6px; margin-bottom:8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
ul { list-style:none; margin:0; padding:0; }
li { padding:6px; border-radius:4px; cursor:pointer; }
li:hover, li.active { background: var(--vscode-list-hoverBackground); }
.meta { font-size:11px; opacity:0.8; }
</style>
</head>
<body>
<div class="toolbar" id="toolbar"></div>
<input id="query" type="text" placeholder="Search DeepLens" />
<ul id="results"></ul>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let selectedScope = 'everything';
let selectedIndex = -1;
let results = [];
const toolbar = document.getElementById('toolbar');
const query = document.getElementById('query');
const list = document.getElementById('results');

function renderScopes(scopes) {
    toolbar.innerHTML = '';
    scopes.forEach((scope) => {
        const btn = document.createElement('button');
        btn.className = 'scope-btn' + (scope === selectedScope ? ' active' : '');
        btn.textContent = scope;
        btn.addEventListener('click', () => {
            selectedScope = scope;
            renderScopes(scopes);
            triggerSearch();
        });
        toolbar.appendChild(btn);
    });
}

function renderResults() {
    list.innerHTML = '';
    results.forEach((result, index) => {
        const li = document.createElement('li');
        li.className = index === selectedIndex ? 'active' : '';

        const titleDiv = document.createElement('div');
        titleDiv.textContent = result.title;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'meta';
        const lineSuffix = result.line ? ':' + result.line : '';
        metaDiv.textContent = result.type + ' • ' + result.detail + lineSuffix;

        li.appendChild(titleDiv);
        li.appendChild(metaDiv);

        li.addEventListener('mouseenter', () => {
            vscode.postMessage({ type: 'preview', index });
        });
        li.addEventListener('dblclick', () => {
            vscode.postMessage({ type: 'open', index });
        });
        list.appendChild(li);
    });
}

function triggerSearch() {
    vscode.postMessage({ type: 'search', query: query.value, scope: selectedScope });
}

query.addEventListener('input', triggerSearch);

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'state') {
        selectedScope = msg.scope;
        query.value = msg.query;
        renderScopes(msg.scopes);
        return;
    }

    if (msg.type === 'results') {
        results = msg.results;
        selectedIndex = msg.selectedIndex;
        renderResults();
        return;
    }

    if (msg.type === 'selection') {
        selectedIndex = msg.selectedIndex;
        renderResults();
    }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
