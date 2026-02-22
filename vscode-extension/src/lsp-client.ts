import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    CloseAction,
    ErrorAction,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
    TransportKind,
} from 'vscode-languageclient/node';
import {
    IndexStats,
    ISearchProvider,
    RipgrepUnavailableNotification,
    SearchOptions,
    SearchResult,
} from '../../language-server/src/core/types';

export class DeepLensLspClient implements ISearchProvider {
    private client: LanguageClient | null = null;
    private readonly context: vscode.ExtensionContext;
    private isStopping = false;
    private startPromise: Promise<void> | null = null;
    private disposables: vscode.Disposable[] = [];
    public onProgress = new vscode.EventEmitter<{
        state: 'start' | 'report' | 'end';
        message?: string;
        percentage?: number;
    }>();
    public onRipgrepUnavailable = new vscode.EventEmitter<void>();

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
            this.startPromise = null;
        }
    }

    private async doStart(): Promise<void> {
        const serverPath = this.getServerPath();

        const serverOptions: ServerOptions = {
            run: { module: serverPath, transport: TransportKind.ipc },
            debug: { module: serverPath, transport: TransportKind.ipc },
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file' }],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher('**/*'),
            },
            initializationOptions: {
                storagePath: this.context.storageUri?.fsPath || this.context.globalStorageUri.fsPath,
                extensionPath: this.context.extensionPath,
            },
            errorHandler: {
                error: () => {
                    if (this.isStopping) {
                        return { action: ErrorAction.Shutdown };
                    }
                    return { action: ErrorAction.Continue };
                },
                closed: () => {
                    if (this.isStopping) {
                        return { action: CloseAction.DoNotRestart };
                    }
                    return { action: CloseAction.Restart };
                },
            },
        };

        this.client = new LanguageClient('deeplensLS', 'DeepLens Language Server', serverOptions, clientOptions);

        this.client.onNotification(
            'deeplens/progress',
            (params: { token: string | number; message?: string; percentage?: number }) => {
                this.handleProgressNotification(params);
            },
        );

        this.client.onNotification(RipgrepUnavailableNotification, () => {
            this.onRipgrepUnavailable.fire();
        });

        await this.client.start();
    }

    private readonly activeProgressTokens = new Set<string>();

    private handleProgressNotification(params: { token: string | number; message?: string; percentage?: number }) {
        const token = String(params.token);

        // If we haven't seen this token before, it's a new task
        if (!this.activeProgressTokens.has(token)) {
            this.activeProgressTokens.add(token);
            this.onProgress.fire({ state: 'start', message: 'Indexing started...' });
        }

        const isFinished =
            params.percentage === 100 ||
            params.message?.startsWith('Done') ||
            params.message === 'Cancelled' ||
            params.message === 'Failed';

        if (isFinished) {
            const message = params.message || 'Done';
            this.onProgress.fire({ state: 'end', message: message, percentage: 100 });
            this.activeProgressTokens.delete(token);
            return;
        }

        this.onProgress.fire({ state: 'report', message: params.message, percentage: params.percentage });
    }

    private getServerPath(): string {
        // Use the bundled server JS file
        return path.join(this.context.extensionPath, 'dist', 'server.js');
    }

    async search(options: SearchOptions, token?: vscode.CancellationToken): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        const client = this.client;
        if (!client) return [];
        try {
            return await client.sendRequest<SearchResult[]>('deeplens/search', options, token);
        } catch (error) {
            // Silently handle errors during shutdown
            if (!this.isStopping) {
                console.error('DeepLens search error:', error);
            }
            return [];
        }
    }

    async burstSearch(options: SearchOptions, token?: vscode.CancellationToken): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        const client = this.client;
        if (!client) return [];
        try {
            return await client.sendRequest<SearchResult[]>('deeplens/burstSearch', options, token);
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens burstSearch error:', error);
            }
            return [];
        }
    }

    async resolveItems(itemIds: string[]): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        const client = this.client;
        if (!client) return [];
        try {
            return await client.sendRequest<SearchResult[]>('deeplens/resolveItems', { itemIds });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens resolveItems error:', error);
            }
            return [];
        }
    }

    async getRecentItems(count: number): Promise<SearchResult[]> {
        if (!this.isReady()) return [];
        const client = this.client;
        if (!client) return [];
        try {
            return await client.sendRequest<SearchResult[]>('deeplens/getRecentItems', { count });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens getRecentItems error:', error);
            }
            return [];
        }
    }

    async clearHistory(): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/clearHistory');
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens clearHistory error:', error);
            }
        }
    }

    async removeHistoryItem(itemId: string): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/removeHistoryItem', { itemId });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens removeHistoryItem error:', error);
            }
        }
    }

    async recordActivity(itemId: string): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/recordActivity', { itemId });
        } catch {
            // Silently ignore activity recording errors - they're not critical
        }
    }

    async setActiveFiles(files: string[]): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/setActiveFiles', { files });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens setActiveFiles error:', error);
            }
        }
    }

    async rebuildIndex(force: boolean = false): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/rebuildIndex', { force });
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens rebuildIndex error:', error);
            }
        }
    }

    async clearCache(): Promise<void> {
        if (!this.isReady()) return;
        const client = this.client;
        if (!client) return;
        try {
            await client.sendRequest('deeplens/clearCache');
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens clearCache error:', error);
            }
        }
    }

    async getIndexStats(): Promise<IndexStats | undefined> {
        if (!this.isReady()) return undefined;
        const client = this.client;
        if (!client) return undefined;
        try {
            return await client.sendRequest<IndexStats>('deeplens/indexStats');
        } catch (error) {
            if (!this.isStopping) {
                console.error('DeepLens getIndexStats error:', error);
            }
            return undefined;
        }
    }

    async stop(): Promise<void> {
        this.isStopping = true;

        await this.waitForStartCompletion();
        await this.stopClientInstance();

        this.disposeTrackedDisposables();

        this.onProgress.dispose();
    }

    private async waitForStartCompletion(): Promise<void> {
        if (this.startPromise === undefined) {
            return;
        }

        try {
            await this.startPromise;
        } catch {
            return;
        }
    }

    private async stopClientInstance(): Promise<void> {
        if (!this.client) {
            return;
        }

        try {
            const clientState = this.client.state;
            if (clientState === State.Running) {
                await this.client.stop();
            } else {
                await this.client.dispose();
            }
        } catch {
            try {
                await this.client?.dispose();
            } catch {
                return;
            }
        } finally {
            this.client = null;
        }
    }

    private disposeTrackedDisposables(): void {
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch {
                continue;
            }
        }
        this.disposables = [];
    }
}
