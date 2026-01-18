import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const results: { name: string, avgMs: number, totalMs: number }[] = [];

// Simple benchmark wrapper
async function benchmark(name: string, fn: () => Promise<void> | void, iterations: number = 1) {
    console.log(`[Benchmark] ${name} (${iterations} iterations)`);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await fn();
    }
    const end = performance.now();
    const totalMs = end - start;
    const avgMs = totalMs / iterations;
    console.log(`  -> Avg: ${avgMs.toFixed(3)}ms | Total: ${totalMs.toFixed(3)}ms`);

    results.push({ name, avgMs, totalMs });
}

suite('Extension Performance Test Suite', () => {
    vscode.window.showInformationMessage('Start Performance Tests');

    suiteTeardown(() => {
        const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'vscode-benchmarks.json');
        try {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
            console.log(`Benchmark results saved to ${outputPath}`);
        } catch (error) {
            console.error(`Failed to save benchmark results: ${error}`);
        }
    });

    test('Activation Time', async () => {
        const start = performance.now();
        const extension = vscode.extensions.getExtension('AhmmedSamier.deeplens');
        assert.ok(extension, 'Extension should be present');

        if (!extension.isActive) {
            await extension.activate();
        }

        const end = performance.now();
        const totalMs = end - start;
        console.log(`Extension Activation took: ${totalMs.toFixed(3)}ms`);

        results.push({ name: 'Activation Time', avgMs: totalMs, totalMs });
    });

    test('Command Execution: deeplens.search', async () => {
        // Wait for extension to be ready
        const extension = vscode.extensions.getExtension('AhmmedSamier.deeplens');
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
