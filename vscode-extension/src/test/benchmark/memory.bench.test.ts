/* eslint-disable @typescript-eslint/no-explicit-any */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Define gc
declare const global: { gc: () => void };

const results: { name: string; memory: unknown; extra?: unknown }[] = [];

function getMemoryUsage() {
    const used = process.memoryUsage();
    return {
        rss: Math.round(used.rss / 1024 / 1024),
        heapTotal: Math.round(used.heapTotal / 1024 / 1024),
        heapUsed: Math.round(used.heapUsed / 1024 / 1024),
        external: Math.round(used.external / 1024 / 1024),
    };
}

function createDelayedSearchEngine(originalSearchEngine: any) {
    return new Proxy(originalSearchEngine, {
        get(target, prop, receiver) {
            if (prop === 'burstSearch' || prop === 'search') {
                return async (...args: any[]) => {
                    // Delay 200ms to ensure we can change the queryId while this is pending
                    // Must be longer than the loop iteration wait but shorter than overall timeout
                    await new Promise((r) => setTimeout(r, 200));
                    return target[prop](...args);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });
}

suite('Extension Memory Benchmark', () => {
    let extension: vscode.Extension<unknown>;
    let api: any; // Keeping api as any as the export type isn't readily available/easy to mock

    suiteSetup(async () => {
        extension = vscode.extensions.getExtension('AhmedSamir.deeplens')!;
        if (extension.isActive) {
            api = extension.exports;
        } else {
            api = await extension.activate();
        }
    });

    suiteTeardown(() => {
        const outputPath = process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, 'vscode-memory-benchmarks.json');
        try {
            const dir = path.dirname(outputPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
            console.log(`Memory Benchmark results saved to ${outputPath}`);
        } catch (error) {
            console.error(`Failed to save benchmark results: ${error}`);
        }
    });

    test('Memory Leak Test', async () => {
        console.log('Initial Memory:', getMemoryUsage());
        results.push({ name: 'Initial', memory: getMemoryUsage() });

        const searchProvider = api.searchProvider;

        // Open search to initialize UI components
        await searchProvider.show();

        const quickPick = searchProvider.currentQuickPick;
        assert.ok(quickPick, 'QuickPick should be initialized');

        // Mock searchEngine to delay execution, forcing the race condition
        const originalSearchEngine = searchProvider.searchEngine;
        const delayedSearchEngine = createDelayedSearchEngine(originalSearchEngine);
        searchProvider.searchEngine = delayedSearchEngine;

        // Simulate Type-Pause-Type sequence
        console.log('Simulating Type-Pause-Type...');
        const iterations = 20;

        for (let i = 0; i < iterations; i++) {
            const query = `test query ${i}`;

            // Call handleQueryChange.
            searchProvider.handleQueryChange(
                quickPick,
                query,
                () => {},
                () => {},
            );

            // Wait 120ms.
            // Phase 2 timeout (100ms) fires. performSearch starts.
            // performSearch calls search (delayed 200ms).
            // We proceed to next iteration (120ms elapsed).
            // search is still pending (needs 80ms more).
            // Next handleQueryChange increments queryId.
            // When search finishes, it sees mismatch and returns early.
            // streamingResults should leak.
            await new Promise((r) => setTimeout(r, 120));
        }

        // Wait for all delayed searches to complete
        console.log('Waiting for searches to settle...');
        await new Promise((r) => setTimeout(r, 3000));

        const afterMemory = getMemoryUsage();
        console.log('Memory After Typing:', afterMemory);

        // Check streamingResults size (Internal check)
        const streamingResultsSize = searchProvider.streamingResults.size;
        console.log('Streaming Results Map Size:', streamingResultsSize);

        results.push({
            name: 'After Typing',
            memory: afterMemory,
            extra: { streamingResultsSize },
        });

        if (global.gc) {
            global.gc();
            const afterGC = getMemoryUsage();
            console.log('Memory After GC:', afterGC);
            results.push({ name: 'After GC', memory: afterGC });
        } else {
            console.log('GC not available (run with --expose-gc)');
        }

        // Restore
        searchProvider.searchEngine = originalSearchEngine;
    });
});
