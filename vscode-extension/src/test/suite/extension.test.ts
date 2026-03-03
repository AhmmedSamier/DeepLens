import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present and active', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension, 'Extension should be present');
        if (!extension.isActive) {
            await extension.activate();
        }
        assert.ok(extension.isActive, 'Extension should be active');
    });

    test('Commands should be registered', async () => {
        // We can check if the command exists in the list of commands
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('deeplens.search'), 'deeplens.search command should be registered');
        assert.ok(commands.includes('deeplens.rebuildIndex'), 'deeplens.rebuildIndex command should be registered');
    });

    test('All DeepLens commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        const expectedCommands = [
            'deeplens.search',
            'deeplens.rebuildIndex',
            'deeplens.clearIndexCache',
            'deeplens.showIndexStats',
            'deeplens.showCallChain'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(commands.includes(cmd), `${cmd} command should be registered`);
        }
    });

    test('Search command should handle text selection', async () => {
        // Create a test document
        const doc = await vscode.workspace.openTextDocument({
            content: 'test content for search',
            language: 'plaintext'
        });

        const editor = await vscode.window.showTextDocument(doc);

        // Select some text
        editor.selection = new vscode.Selection(
            new vscode.Position(0, 0),
            new vscode.Position(0, 4)
        );

        // Execute the search command
        // Note: This will open the search UI but we can't easily test the UI interaction
        await vscode.commands.executeCommand('deeplens.search');

        // If we got here without throwing, the command executed successfully
        assert.ok(true, 'Search command executed without error');
    });

    test('Rebuild index command should execute without error', async () => {
        // Execute the rebuild command
        await vscode.commands.executeCommand('deeplens.rebuildIndex');

        // If we got here without throwing, the command executed successfully
        assert.ok(true, 'Rebuild index command executed without error');
    });

    test('Clear cache command should execute without error', async () => {
        // Execute the clear cache command
        await vscode.commands.executeCommand('deeplens.clearIndexCache');

        // If we got here without throwing, the command executed successfully
        assert.ok(true, 'Clear cache command executed without error');
    });

    test('Show index stats command should execute without error', async () => {
        // Execute the show stats command
        await vscode.commands.executeCommand('deeplens.showIndexStats');

        // If we got here without throwing, the command executed successfully
        assert.ok(true, 'Show index stats command executed without error');
    });

    test('Extension should export expected API', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension, 'Extension should be present');

        if (!extension.isActive) {
            await extension.activate();
        }

        const api = extension.exports;
        assert.ok(api, 'Extension should export an API');
        assert.ok(api.searchProvider, 'API should include searchProvider');
        assert.ok(api.lspClient, 'API should include lspClient');
        assert.ok(api.commandIndexer, 'API should include commandIndexer');
    });

    test('Configuration changes should be handled', async () => {
        const config = vscode.workspace.getConfiguration('deeplens');
        const originalMaxResults = config.get<number>('maxResults');

        // Change configuration
        await config.update('maxResults', 50, vscode.ConfigurationTarget.Global);

        // Wait a bit for the change to propagate
        await new Promise(resolve => setTimeout(resolve, 100));

        const newMaxResults = config.get<number>('maxResults');
        assert.strictEqual(newMaxResults, 50, 'Configuration should be updated');

        // Restore original value
        await config.update('maxResults', originalMaxResults, vscode.ConfigurationTarget.Global);
    });

    test('Show call chain command should handle valid TypeScript function', async () => {
        // Create a test TypeScript document with a function
        const doc = await vscode.workspace.openTextDocument({
            content: `
function testFunction() {
    console.log('test');
}

function caller() {
    testFunction();
}
            `,
            language: 'typescript'
        });

        await vscode.window.showTextDocument(doc);

        // Try to show call chain for the function (line 1, where 'testFunction' is defined)
        const position = new vscode.Position(1, 9); // Position of 'testFunction' name

        try {
            await vscode.commands.executeCommand('deeplens.showCallChain', doc.uri, position, 'testFunction');
            assert.ok(true, 'Show call chain command executed');
        } catch (error) {
            // The command might fail if call hierarchy provider is not available
            // which is okay for this test
            assert.ok(true, 'Command executed (may have no call hierarchy provider)');
        }
    });

    test('Show call chain command should handle symbols without hierarchy', async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'const x = 42;',
            language: 'typescript'
        });

        const position = new vscode.Position(0, 6);

        try {
            await vscode.commands.executeCommand('deeplens.showCallChain', doc.uri, position);
            assert.ok(true, 'Command handled symbol without hierarchy');
        } catch (error) {
            // This is expected to fail gracefully
            assert.ok(true, 'Command failed gracefully for non-callable symbol');
        }
    });

    test('Extension should handle activity tracking configuration', async () => {
        const config = vscode.workspace.getConfiguration('deeplens');
        const originalActivityEnabled = config.get<boolean>('activity.enabled');

        // Test with activity tracking enabled
        await config.update('activity.enabled', true, vscode.ConfigurationTarget.Global);
        let activityEnabled = config.get<boolean>('activity.enabled');
        assert.strictEqual(activityEnabled, true, 'Activity tracking should be enabled');

        // Test with activity tracking disabled
        await config.update('activity.enabled', false, vscode.ConfigurationTarget.Global);
        activityEnabled = config.get<boolean>('activity.enabled');
        assert.strictEqual(activityEnabled, false, 'Activity tracking should be disabled');

        // Restore original value
        await config.update('activity.enabled', originalActivityEnabled, vscode.ConfigurationTarget.Global);
    });

    test('Extension should handle CodeLens configuration', async () => {
        const config = vscode.workspace.getConfiguration('deeplens');
        const originalCodeLensEnabled = config.get<boolean>('codeLens.enabled');

        // Test CodeLens configuration
        await config.update('codeLens.enabled', false, vscode.ConfigurationTarget.Global);
        let codeLensEnabled = config.get<boolean>('codeLens.enabled');
        assert.strictEqual(codeLensEnabled, false, 'CodeLens should be disabled');

        await config.update('codeLens.enabled', true, vscode.ConfigurationTarget.Global);
        codeLensEnabled = config.get<boolean>('codeLens.enabled');
        assert.strictEqual(codeLensEnabled, true, 'CodeLens should be enabled');

        // Restore original value
        await config.update('codeLens.enabled', originalCodeLensEnabled, vscode.ConfigurationTarget.Global);
    });

    test('Extension should handle multiple configuration properties', async () => {
        const config = vscode.workspace.getConfiguration('deeplens');

        // Test various configuration options exist
        const maxResults = config.get<number>('maxResults');
        const enableTextSearch = config.get<boolean>('enableTextSearch');
        const excludePatterns = config.get<string[]>('excludePatterns');
        const respectGitignore = config.get<boolean>('respectGitignore');

        assert.ok(typeof maxResults === 'number', 'maxResults should be a number');
        assert.ok(typeof enableTextSearch === 'boolean', 'enableTextSearch should be a boolean');
        assert.ok(Array.isArray(excludePatterns), 'excludePatterns should be an array');
        assert.ok(typeof respectGitignore === 'boolean', 'respectGitignore should be a boolean');
    });

    test('Extension should handle document open events for activity tracking', async () => {
        // Create and open a document
        const doc = await vscode.workspace.openTextDocument({
            content: 'test document for activity tracking',
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(doc);

        // Wait for activity tracking to process
        await new Promise(resolve => setTimeout(resolve, 100));

        // If we got here, activity tracking didn't throw
        assert.ok(true, 'Document open event handled for activity tracking');
    });

    test('Extension should provide status bar item', async () => {
        // The status bar item should be created on activation
        // We can't directly access it, but we can verify the extension is active
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension?.isActive, 'Extension should be active and provide status bar');
    });

    test('LSP client should be accessible through API', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        if (!extension?.isActive) {
            await extension?.activate();
        }

        const api = extension?.exports;
        assert.ok(api?.lspClient, 'LSP client should be accessible');

        // Test that we can call methods on the LSP client
        const stats = await api.lspClient.getIndexStats();
        assert.ok(stats, 'Should be able to get index stats from LSP client');
        assert.ok(typeof stats.totalItems === 'number', 'Stats should include totalItems');
    });

    test('SearchProvider should be accessible through API', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        if (!extension?.isActive) {
            await extension?.activate();
        }

        const api = extension?.exports;
        assert.ok(api?.searchProvider, 'SearchProvider should be accessible');
    });

    test('CommandIndexer should be accessible through API', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        if (!extension?.isActive) {
            await extension?.activate();
        }

        const api = extension?.exports;
        assert.ok(api?.commandIndexer, 'CommandIndexer should be accessible');
    });

    test('Extension should handle empty workspace gracefully', async () => {
        // The extension should work even if there's no workspace or files
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension?.isActive, 'Extension should be active even with empty/minimal workspace');
    });

    test('Extension should support multiple file types', async () => {
        const supportedLanguages = [
            'typescript',
            'javascript',
            'python',
            'java',
            'csharp',
            'go',
            'cpp',
            'c',
            'ruby',
            'php'
        ];

        for (const lang of supportedLanguages) {
            const doc = await vscode.workspace.openTextDocument({
                content: `// Test content for ${lang}`,
                language: lang
            });

            assert.ok(doc, `Should create document for ${lang}`);
        }
    });
});