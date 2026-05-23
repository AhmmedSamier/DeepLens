import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { SearchScope, SearchItemType, SearchResult } from '../../../../language-server/src/core/types';
import { SearchPanelProvider } from '../../search-panel-provider';

class MockWebview {
    public html = '';
    public options: vscode.WebviewOptions | undefined;
    public readonly cspSource = 'vscode-resource:';
    private messageHandler: ((msg: unknown) => void | Promise<void>) | null = null;
    public readonly posted: unknown[] = [];

    onDidReceiveMessage(handler: (e: unknown) => void | Promise<void>): vscode.Disposable {
        this.messageHandler = handler;
        return new vscode.Disposable(() => {
            this.messageHandler = null;
        });
    }

    postMessage(message: unknown): Promise<boolean> {
        this.posted.push(message);
        return Promise.resolve(true);
    }

    async emitMessage(message: unknown): Promise<void> {
        if (this.messageHandler) {
            await this.messageHandler(message);
        }
    }
}

class MockWebviewView {
    public readonly webview = new MockWebview() as unknown as vscode.Webview;
    private disposeHandler: (() => void) | null = null;

    onDidDispose(handler: () => void): vscode.Disposable {
        this.disposeHandler = handler;
        return new vscode.Disposable(() => {
            this.disposeHandler = null;
        });
    }

    dispose(): void {
        this.disposeHandler?.();
    }
}

suite('SearchPanelProvider Unit Test Suite', () => {
    test('scope switch should affect search and return results', async () => {
        const burstCalls: Array<{ query: string; scope: SearchScope }> = [];
        const fakeResults: SearchResult[] = [
            {
                item: {
                    id: '1',
                    name: 'employee-service.ts',
                    type: SearchItemType.FILE,
                    filePath: '/workspace/DeepLens/.test-fixtures/employee-service.ts',
                    relativeFilePath: 'src/employee-service.ts',
                    line: 10,
                    column: 5,
                },
                score: 0.9,
                scope: SearchScope.FILES,
            },
        ];

        const fakeClient = {
            burstSearch: async (options: { query: string; scope: SearchScope }) => {
                burstCalls.push({ query: options.query, scope: options.scope });
                return fakeResults;
            },
            recordActivity: async () => {},
        } as unknown as { burstSearch: (opts: { query: string; scope: SearchScope }) => Promise<SearchResult[]> };

        const provider = new SearchPanelProvider({} as vscode.ExtensionContext, fakeClient as never);
        const view = new MockWebviewView();
        provider.resolveWebviewView(view as unknown as vscode.WebviewView);

        await (view.webview as unknown as MockWebview).emitMessage({ type: 'search', query: 'employee', scope: 'files' });

        assert.strictEqual(burstCalls.length, 1, 'burstSearch should be called once');
        assert.strictEqual(burstCalls[0].scope, SearchScope.FILES, 'scope should switch to files');
        assert.strictEqual(burstCalls[0].query, 'employee', 'query should be forwarded');

        const posted = (view.webview as unknown as MockWebview).posted;
        const resultsMessage = posted.find((m) => (m as { type?: string }).type === 'results') as {
            type: string;
            results: Array<{ title: string }>;
        };

        assert.ok(resultsMessage, 'results message should be posted');
        assert.strictEqual(resultsMessage.results.length, 1, 'should post one search result');
        assert.strictEqual(resultsMessage.results[0].title, 'employee-service.ts', 'result title should match');
    });


    test('stale response should not overwrite latest search results', async () => {
        let resolveOld: ((value: SearchResult[]) => void) | null = null;

        const oldResults: SearchResult[] = [
            {
                item: {
                    id: 'old-1',
                    name: 'old-result.ts',
                    type: SearchItemType.FILE,
                    filePath: '/workspace/DeepLens/.test-fixtures/old-result.ts',
                    relativeFilePath: 'src/old-result.ts',
                },
                score: 0.5,
                scope: SearchScope.FILES,
            },
        ];

        const newResults: SearchResult[] = [
            {
                item: {
                    id: 'new-1',
                    name: 'new-result.ts',
                    type: SearchItemType.FILE,
                    filePath: '/workspace/DeepLens/.test-fixtures/new-result.ts',
                    relativeFilePath: 'src/new-result.ts',
                },
                score: 0.9,
                scope: SearchScope.FILES,
            },
        ];

        const fakeClient = {
            burstSearch: (options: { query: string; scope: SearchScope }) => {
                if (options.query === 'old') {
                    return new Promise<SearchResult[]>((resolve) => {
                        resolveOld = resolve;
                    });
                }

                if (options.query === 'new') {
                    return Promise.resolve(newResults);
                }

                return Promise.resolve([]);
            },
            recordActivity: async () => {},
        } as unknown as { burstSearch: (opts: { query: string; scope: SearchScope }) => Promise<SearchResult[]> };

        const provider = new SearchPanelProvider({} as vscode.ExtensionContext, fakeClient as never);
        const view = new MockWebviewView();
        provider.resolveWebviewView(view as unknown as vscode.WebviewView);

        const webview = view.webview as unknown as MockWebview;
        const oldSearch = webview.emitMessage({ type: 'search', query: 'old', scope: 'files' });
        await webview.emitMessage({ type: 'search', query: 'new', scope: 'files' });

        resolveOld?.(oldResults);
        await oldSearch;

        const resultsMessages = webview.posted.filter((m) => (m as { type?: string }).type === 'results') as Array<{
            type: string;
            results: Array<{ title: string }>;
        }>;

        assert.ok(resultsMessages.length >= 1, 'should post at least one results message');
        const finalMessage = resultsMessages[resultsMessages.length - 1];
        assert.strictEqual(finalMessage.results.length, 1, 'final result set should include one item');
        assert.strictEqual(finalMessage.results[0].title, 'new-result.ts', 'latest search results should win');
    });

});
