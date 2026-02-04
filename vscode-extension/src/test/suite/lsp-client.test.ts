import * as assert from 'assert';
import * as vscode from 'vscode';
import { DeepLensLspClient } from '../../lsp-client';

type ProgressEvent = {
    state: 'start' | 'report' | 'end';
    message?: string;
    percentage?: number;
};

const createClient = () => {
    const context = {
        extensionPath: '/tmp/deeplens',
        globalStorageUri: vscode.Uri.file('/tmp/deeplens-storage'),
    } as vscode.ExtensionContext;

    return new DeepLensLspClient(context);
};

const getProgressEvents = (client: DeepLensLspClient) => {
    const events: ProgressEvent[] = [];
    const disposable = client.onProgress.event((event) => {
        events.push(event);
    });

    return { events, disposable };
};

suite('DeepLensLspClient progress events', () => {
    test('Emits end event on cancellation', () => {
        const client = createClient();
        const { events, disposable } = getProgressEvents(client);

        (client as unknown as { handleProgressCreation: (params: { token: string }) => void }).handleProgressCreation({
            token: 'branch-switch',
        });
        (
            client as unknown as {
                handleProgressNotification: (params: {
                    token: string;
                    message?: string;
                    percentage?: number;
                }) => void;
            }
        ).handleProgressNotification({ token: 'branch-switch', message: 'Cancelled' });

        disposable.dispose();

        assert.strictEqual(events[0]?.state, 'start');
        assert.strictEqual(events[1]?.state, 'end');
        assert.strictEqual(events[1]?.message, 'Cancelled');
        assert.strictEqual(events[1]?.percentage, 100);
    });

    test('Emits end event on failure', () => {
        const client = createClient();
        const { events, disposable } = getProgressEvents(client);

        (client as unknown as { handleProgressCreation: (params: { token: string }) => void }).handleProgressCreation({
            token: 'index-failure',
        });
        (
            client as unknown as {
                handleProgressNotification: (params: {
                    token: string;
                    message?: string;
                    percentage?: number;
                }) => void;
            }
        ).handleProgressNotification({ token: 'index-failure', message: 'Failed' });

        disposable.dispose();

        assert.strictEqual(events[0]?.state, 'start');
        assert.strictEqual(events[1]?.state, 'end');
        assert.strictEqual(events[1]?.message, 'Failed');
        assert.strictEqual(events[1]?.percentage, 100);
    });
});
