import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SearchOptions, SearchScope } from '../../../../language-server/src/core/types';

const results: { name: string; avgMs: number; totalMs: number }[] = [];

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
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
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
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        await extension?.activate();

        await benchmark(
            'Execute Search Command',
            async () => {
                await vscode.commands.executeCommand('deeplens.search');
                await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
            },
            5,
        );
    });

    test('Search Request Latency: deeplens/search', async () => {
        const extension = vscode.extensions.getExtension('AhmedSamir.deeplens');
        assert.ok(extension, 'Extension should be present');
        const api = extension.isActive ? extension.exports : await extension.activate();

        // Allow the LSP process to start and complete initialization.
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const options: SearchOptions = {
            query: 'test',
            maxResults: 50,
            scope: SearchScope.EVERYTHING,
        };

        await benchmark(
            'Search Request Latency',
            async () => {
                const results = await api.lspClient.search(options);
                assert.ok(Array.isArray(results), 'Search should return an array');
            },
            10,
        );
    });
});
