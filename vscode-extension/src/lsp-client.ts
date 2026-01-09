import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import * as path from 'path';
import * as fs from 'fs';
import { SearchOptions, SearchResult } from '../../language-server/src/core/types';
import { ISearchProvider } from '../../language-server/src/core/search-interface';

export class DeepLensLspClient implements ISearchProvider {
    private client: LanguageClient | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async start(): Promise<void> {
        const serverPath = this.getServerPath();

        const serverOptions: ServerOptions = {
            run: { command: serverPath, args: ['--stdio'] },
            debug: { command: serverPath, args: ['--stdio'] }
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
    }

    private handleProgressCreation(params: { token: string | number }) {
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
                    setTimeout(() => {
                        resolve();
                        disposable.dispose();
                    }, 7000);
                    return;
                }

                let increment: number | undefined;
                if (value.percentage !== undefined) {
                    increment = value.percentage - lastPercentage;
                    lastPercentage = value.percentage;
                }

                progress.report({ message: value.message, increment });
            },
        );
    }

    private getServerPath(): string {
        // Try local dev path first
        let serverPath = path.join(this.context.extensionPath, 'dist', 'deeplens-lsp.exe');
        if (!fs.existsSync(serverPath)) {
            // Try root path (for packaged extension)
            serverPath = path.join(this.context.extensionPath, 'deeplens-lsp.exe');
        }
        return serverPath;
    }

    async search(options: SearchOptions): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/search', options);
    }

    async burstSearch(options: SearchOptions): Promise<SearchResult[]> {
        if (!this.client) return [];
        return await this.client.sendRequest<SearchResult[]>('deeplens/burstSearch', options);
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

    async stop(): Promise<void> {
        if (this.client) {
            await this.client.stop();
        }
    }
}
