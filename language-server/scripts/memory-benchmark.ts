
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType } from '../src/core/types';

function getMemoryUsage() {
    const used = process.memoryUsage();
    return {
        rss: Math.round((used.rss / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((used.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsed: Math.round((used.heapUsed / 1024 / 1024) * 100) / 100,
        external: Math.round((used.external / 1024 / 1024) * 100) / 100,
    };
}

async function runMemoryBenchmark() {
    const snapshots: { name: string; memory: ReturnType<typeof getMemoryUsage> }[] = [];

    console.log('=== Memory Benchmark ===');
    const initial = getMemoryUsage();
    console.log('Initial Memory (MB):', initial);
    snapshots.push({ name: 'Initial', memory: initial });

    const engine = new SearchEngine();
    const itemCount = 15000;
    const items: any[] = [];


    console.log(`Generating ${itemCount} files (approx 75k items total)...`);


    for (let i = 0; i < itemCount; i++) {
        const fileName = `File${i}Component.ts`;
        const folder = `src/features/feature${i % 100}/components`;
        const path = `${folder}/${fileName}`;

        // Note: In production, WorkspaceIndexer interns these strings.
        // Here we allocate new strings, so SearchableItem memory usage will be higher than production.
        // However, this test primarily stresses the SearchEngine's PreparedItem memory usage,
        // which was the bottleneck (fuzzysort objects).

        items.push({
            id: `file:${path}`,
            name: fileName,
            type: SearchItemType.FILE,
            filePath: `/project/${path}`,
            relativeFilePath: path,
            fullName: path
        });

        // Add a class
        items.push({
            id: `class:${path}:File${i}Component`,
            name: `File${i}Component`,
            type: SearchItemType.CLASS,
            filePath: `/project/${path}`,
            relativeFilePath: path,
            fullName: `File${i}Component`,
            containerName: ''
        });

        // Add some methods
        for (let j = 0; j < 3; j++) {
            items.push({
                id: `method:${path}:method${j}`,
                name: `method${j}`,
                type: SearchItemType.METHOD,
                filePath: `/project/${path}`,
                relativeFilePath: path,
                fullName: `File${i}Component.method${j}`,
                containerName: `File${i}Component`
            });
        }
    }

    console.log(`Items generated. Count: ${items.length}`);
    const beforeIndexing = getMemoryUsage();
    console.log('Memory before indexing (MB):', beforeIndexing);
    snapshots.push({ name: 'Before Indexing', memory: beforeIndexing });

    const start = Date.now();
    await engine.setItems(items);
    const duration = Date.now() - start;


    console.log(`Indexing took ${duration}ms`);
    const afterIndexing = getMemoryUsage();
    console.log('Memory after indexing (MB):', afterIndexing);
    snapshots.push({ name: 'After Indexing', memory: afterIndexing });

    if (global.gc) {
        global.gc();
        const afterGc = getMemoryUsage();
        console.log('Memory after GC (MB):', afterGc);
        snapshots.push({ name: 'After GC', memory: afterGc });
    }

    const outputPath =
        process.env.BENCHMARK_OUTPUT || path.resolve(__dirname, '../benchmarks/memory-benchmark.json');
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(snapshots, null, 2));
        console.log(`Memory benchmark results saved to ${outputPath}`);
    } catch (error) {
        console.error('Failed to save memory benchmark results:', error);
    }

    console.log('Benchmark complete.');
}

runMemoryBenchmark().catch(console.error);
