import * as assert from 'assert';
import * as vscode from 'vscode';

// Simple benchmark wrapper
async function benchmark(name: string, fn: () => Promise<void> | void, iterations: number = 1) {
    console.log(`[Benchmark] ${name} (${iterations} iterations)`);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await fn();
    }
    const end = performance.now();
    const avg = (end - start) / iterations;
    console.log(`  -> Avg: ${avg.toFixed(3)}ms | Total: ${(end - start).toFixed(3)}ms`);
}

suite('Extension Performance Test Suite', () => {
    vscode.window.showInformationMessage('Start Performance Tests');

    test('Activation Time', async () => {
        const start = performance.now();
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension, 'Extension should be present');

        if (!extension.isActive) {
            await extension.activate();
        }

        const end = performance.now();
        console.log(`Extension Activation took: ${(end - start).toFixed(3)}ms`);
    });

    test('Command Execution: deeplens.search', async () => {
        // Wait for extension to be ready
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        await extension?.activate();

        // Allow some time for language server to start
        await new Promise(r => setTimeout(r, 2000));

        await benchmark('Execute Search Command', async () => {
            // We just trigger the command, we can't easily measure until results appear without more complex hooks
            // But checking that the command triggers without error is a start.
            // In a real scenario, we might want to expose an API to wait for search completion.
            await vscode.commands.executeCommand('deeplens.search');

            // Close the quick pick if possible (Escape)
            await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        }, 5);
    });
});
