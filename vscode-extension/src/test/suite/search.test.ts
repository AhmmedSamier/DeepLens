import * as assert from 'assert';
import * as vscode from 'vscode';
// We import SearchScope from the actual source to ensure type safety in tests
import { SearchItemType, SearchScope } from '../../../../language-server/src/core/types';

suite('Search Integration Test Suite', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let extension: vscode.Extension<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let api: any;

    suiteSetup(async function () {
        this.timeout(60000); // Give it a minute to index

        extension = vscode.extensions.getExtension('AhmedSamir.deeplens')!;
        api = await extension.activate();

        console.log('Waiting for DeepLens indexing to complete...');

        // Wait for indexing to complete by polling index stats
        let isDone = false;
        const startTime = Date.now();
        while (!isDone && Date.now() - startTime < 45000) {
            const stats = await api.lspClient.getIndexStats();
            if (stats && !stats.indexing && stats.totalItems > 0) {
                isDone = true;
                console.log(`Indexing complete: ${stats.totalItems} items found.`);
            } else {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        if (!isDone) {
            console.warn('Indexing timed out or no items found, but continuing tests anyway.');
        }
    });

    test('Search EVERYTHING should return various types of results', async () => {
        const results = await api.lspClient.search({
            query: 'User',
            scope: SearchScope.EVERYTHING,
        });

        assert.ok(results.length > 0, 'Should find some results for "User"');

        const types = results.map((r) => r.item.type);
        assert.ok(types.includes(SearchItemType.CLASS), 'Should find at least one class');

        const names = results.map((r) => r.item.name);
        assert.ok(
            names.some((n) => n.includes('UserService')),
            'Should find UserService',
        );
    });

    test('Search TYPES should return only classes, interfaces, or enums', async () => {
        const results = await api.lspClient.search({
            query: 'User',
            scope: SearchScope.TYPES,
        });

        assert.ok(results.length > 0, 'Should find types');
        results.forEach((r) => {
            const isType = [SearchItemType.CLASS, SearchItemType.INTERFACE, SearchItemType.ENUM].includes(r.item.type);
            assert.ok(isType, `Item ${r.item.name} of type ${r.item.type} is not a Type`);
        });
    });

    test('Search SYMBOLS should return methods or functions', async () => {
        const results = await api.lspClient.search({
            query: 'add',
            scope: SearchScope.SYMBOLS,
        });

        assert.ok(results.length > 0, 'Should find symbols');
        assert.ok(
            results.some((r) => r.item.name === 'addUser'),
            'Should find addUser method',
        );
    });

    test('Search FILES should return matching file names', async () => {
        const results = await api.lspClient.search({
            query: 'sample',
            scope: SearchScope.FILES,
        });

        assert.ok(results.length > 0, 'Should find files');
        const filePaths = results.map((r) => r.item.filePath);
        assert.ok(
            filePaths.some((p) => p.endsWith('sample.ts')),
            'Should find sample.ts',
        );
        assert.ok(
            filePaths.some((p) => p.endsWith('sample.js')),
            'Should find sample.js',
        );
    });

    test('Search TEXT should find content inside files', async () => {
        const results = await api.lspClient.search({
            query: 'fuzzy matching',
            scope: SearchScope.TEXT,
        });

        assert.ok(results.length > 0, 'Should find text content');
        assert.ok(
            results.some((r) => r.item.filePath.endsWith('data.txt')),
            'Should find result in data.txt',
        );
    });

    test('Search ENDPOINTS should find C# API routes', async () => {
        const results = await api.lspClient.search({
            query: 'api/Users',
            scope: SearchScope.ENDPOINTS,
        });

        assert.ok(results.length > 0, 'Should find endpoints');
        assert.ok(
            results.some((r) => r.item.name.includes('[GET] api/Users')),
            'Should find GET Users endpoint',
        );
    });

    test('Search COMMANDS should find VS Code commands', async () => {
        // Commands are handled locally by CommandIndexer, not LSP
        const results = api.commandIndexer.search('DeepLens');

        assert.ok(results.length > 0, 'Should find commands');
        assert.ok(
            results.some((r) => r.item.commandId === 'deeplens.search'),
            'Should find deeplens.search command',
        );
    });
});
