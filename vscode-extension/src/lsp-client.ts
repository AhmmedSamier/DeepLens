import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import * as path from 'path';
import { SearchOptions, SearchResult, IndexStats } from '../../language-server/src/core/types';
import { ISearchProvider } from '../../language-server/src/core/search-interface';

export class DeepLensLspClient implements ISearchProvider {
    private client: LanguageClient | undefined;
    private context: vscode.ExtensionContext;
    public onProgress = new vscode.EventEmitter<{ state: 'start' | 'report' | 'end'; message?: string; percentage?: number }>();
    public onStreamResult = new vscode.EventEmitter<{ requestId?: number; result: SearchResult }>();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async start(): Promise<void> {
        const serverPath = this.getServerPath();

        const serverOptions: ServerOptions = {
            run: { module: serverPath, transport: TransportKind.stdio },
            debug: { module: serverPath, transport: TransportKind.stdio }
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: '*' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*')
            },
            initializationOptions: {
                storagePath: this.context.globalStorageUri.fsPath,
                extensionPath: this.context.extensionPath
            }
        };

        this.client = new LanguageClient(
            'deeplensLS',
            'DeepLens Language Server',
            serverOptions,
            clientOptions
        );

        await this.client.start();

        // Handle server progress reporting
        this.client.onRequest('window/workDoneProgress/create', async (params: { token: string | number }) => {
            this.handleProgressCreation(params);
        });

        // Handle streamed search results
        this.client.onNotification('deeplens/streamResult', (params: { requestId?: number; result: SearchResult }) => {
            this.onStreamResult.fire(params);
        });
    }

    private handleProgressCreation(params: { token: string | number }) {
        this.onProgress.fire({ state: 'start', message: 'Indexing started...' });

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'DeepLens Indexing',
                cancellable: false,
            },
            (progress) => {
                return new Promise<void>((resolve) => {
                    this.createProgressHandler(params.token.toString(), progress, resolve);
                });
            },
        );
    }

    private createProgressHandler(
        token: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        resolve: () => void
    ) {
        let lastPercentage = 0;
        const disposable = this.client!.onNotification(
            'deeplens/progress',
            (value: { token: string | number; message?: string; percentage?: number }) => {
                if (String(value.token) !== token) {
                    return;
                }

                if (value.percentage === 100 || value.message?.startsWith('Done')) {
                    progress.report({ message: value.message || 'Done', increment: 100 - lastPercentage });
                    this.onProgress.fire({ state: 'end', message: value.message || 'Done', percentage: 100 });

                    setTimeout(() => {
                        resolve();
                        disposable.dispose();
                    }, 3000);
                    return;
                }

                let increment: number | undefined;
                if (value.percentage !== undefined) {
                    increment = value.percentage - lastPercentage;
                    lastPercentage = value.percentage;
                }

                progress.report({ message: value.message, increment });
                this.onProgress.fire({ state: 'report', message: value.message, percentage: value.percentage });
            },
        );
    }

    private getServerPath(): string {
        // Use the bundled server JS file
        return path.join(this.context.extensionPath, 'dist', 'server.js');
    }

    async search(options: SearchOptions): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/search', options);
    }

    async burstSearch(options: SearchOptions): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/burstSearch', options);
    }

    async resolveItems(itemIds: string[]): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/resolveItems', { itemIds });
    }

    async getRecentItems(count: number): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/getRecentItems', { count });
    }

    async recordActivity(itemId: string): Promise<void> {
        if (!this.client) return;
        await this.client.sendRequest('deeplens/recordActivity', { itemId });
    }

    async rebuildIndex(force: boolean = false): Promise<void> {
        if (!this.client) return;
        await this.client.sendRequest('deeplens/rebuildIndex', { force });
    }

    async clearCache(): Promise<void> {
        if (!this.client) return;
        await this.client.sendRequest('deeplens/clearCache');
    }

    async getIndexStats(): Promise<IndexStats | undefined> {
        if (!this.client) return undefined;
        return await this.client.sendRequest<IndexStats>('deeplens/indexStats');
    }

    async stop(): Promise<void> {
        if (this.client) {
            await this.client.stop();
        }
        this.onProgress.dispose();
        this.onStreamResult.dispose();
    }
}
