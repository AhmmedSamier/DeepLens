import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind, ErrorAction, CloseAction, State } from 'vscode-languageclient/node';
import * as path from 'path';
import { SearchOptions, SearchResult, IndexStats } from '../../language-server/src/core/types';
import { ISearchProvider } from '../../language-server/src/core/search-interface';

export class DeepLensLspClient implements ISearchProvider {
    private client: LanguageClient | undefined;
    private context: vscode.ExtensionContext;
    private isStopping = false;
    private startPromise: Promise<void> | undefined;
    public onProgress = new vscode.EventEmitter<{ state: 'start' | 'report' | 'end'; message?: string; percentage?: number }>();
    public onStreamResult = new vscode.EventEmitter<{ requestId?: number; result: SearchResult }>();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Check if the client is ready to send requests
     */
    private isReady(): boolean {
        return !!(this.client && !this.isStopping && this.client.isRunning());
    }

    async start(): Promise<void> {
        // Track the start operation so stop() can wait for it
        this.startPromise = this.doStart();
        try {
            await this.startPromise;
        } finally {
            this.startPromise = undefined;
        }
    }

    private async doStart(): Promise<void> {
        const serverPath = this.getServerPath();

        const serverOptions: ServerOptions = {
            run: { module: serverPath, transport: TransportKind.ipc },
            debug: { module: serverPath, transport: TransportKind.ipc }
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: '*' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*')
            },
            initializationOptions: {
                storagePath: this.context.storageUri?.fsPath || this.context.globalStorageUri.fsPath,
                extensionPath: this.context.extensionPath
            },
            errorHandler: {
                error: () => {
                    // Suppress errors during shutdown
                    if (this.isStopping) {
                        return { action: ErrorAction.Shutdown };
                    }
                    // Default: shutdown on errors (don't keep a broken client running)
                    return { action: ErrorAction.Shutdown };
                },
                closed: () => {
                    // Don't restart if we're stopping
                    if (this.isStopping) {
                        return { action: CloseAction.DoNotRestart };
                    }
                    // Default: don't restart
                    return { action: CloseAction.DoNotRestart };
                }
            }
        };

        this.client = new LanguageClient(
            'deeplensLS',
            'DeepLens Language Server',
            serverOptions,
            clientOptions
        );

        // Listen for state changes to detect unexpected disconnects
        this.client.onDidChangeState((event) => {
            if (event.newState === State.Stopped) {
                // Server stopped unexpectedly - set flag to prevent further errors
                this.isStopping = true;
            }
        });

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
        if (!this.isReady()) return [];
        try {
            return await this.client!.sendRequest<SearchResult[]>('deeplens/search', options);
        } catch (error) {
            // Silently handle errors during shutdown
            if (!this.isStopping) {
                console.error('DeepLens search error:', error);
            }
            return [];
        }
    }

    async burstSearch(options: SearchOptions): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        try {
            return await this.client!.sendRequest<SearchResult[]>('deeplens/burstSearch', options);
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens burstSearch error:', error);
            }
            return [];
        }
    }

    async resolveItems(itemIds: string[]): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        try {
            return await this.client!.sendRequest<SearchResult[]>('deeplens/resolveItems', { itemIds });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens resolveItems error:', error);
            }
            return [];
        }
    }

    async getRecentItems(count: number): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        try {
            return await this.client!.sendRequest<SearchResult[]>('deeplens/getRecentItems', { count });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens getRecentItems error:', error);
            }
            return [];
        }
    }

    async recordActivity(itemId: string): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.client!.sendRequest('deeplens/recordActivity', { itemId });
        } catch (error) {
            // Silently ignore activity recording errors - they're not critical
        }
    }

    async rebuildIndex(force: boolean = false): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.client!.sendRequest('deeplens/rebuildIndex', { force });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens rebuildIndex error:', error);
            }
        }
    }

    async clearCache(): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.client!.sendRequest('deeplens/clearCache');
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens clearCache error:', error);
            }
        }
    }

    async getIndexStats(): Promise<IndexStats | undefined> {
        if (!this.isReady()) return undefined;
        try {
            return await this.client!.sendRequest<IndexStats>('deeplens/indexStats');
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens getIndexStats error:', error);
            }
            return undefined;
        }
    }

    async stop(): Promise<void> {
        // Set flag first to prevent any new requests
        this.isStopping = true;

        // Wait for any ongoing start operation to complete
        if (this.startPromise) {
            try {
                await this.startPromise;
            } catch {
                // Ignore start errors during stop
            }
        }

        if (this.client) {
            try {
                // Check actual client state - only stop if running
                const clientState = this.client.state;
                if (clientState === State.Running) {
                    await this.client.stop();
                } else if (clientState === State.Starting) {
                    // Client is still starting - just dispose, don't try to stop
                    this.client.dispose();
                } else {
                    // Client is stopped or stopping - just dispose
                    this.client.dispose();
                }
            } catch {
                // Ignore errors during stop - the client may already be disconnected
                // Try to dispose as a last resort cleanup
                try {
                    this.client.dispose();
                } catch {
                    // Ignore dispose errors too
                }
            }
            this.client = undefined;
        }
        this.onProgress.dispose();
        this.onStreamResult.dispose();
    }
}

