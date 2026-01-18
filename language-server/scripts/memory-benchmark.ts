
import { SearchEngine } from '../src/core/search-engine';
import { SearchItemType } from '../src/core/types';

function getMemoryUsage() {
    const used = process.memoryUsage();
    return {
        rss: `${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`,
        external: `${Math.round(used.external / 1024 / 1024 * 100) / 100} MB`,
    };
}

async function runMemoryBenchmark() {
    console.log("=== Memory Benchmark ===");
    console.log("Initial Memory:", getMemoryUsage());

    const engine = new SearchEngine();
    const itemCount = 200000; // Simulate a large repo (200k files + symbols -> ~1M items)
    const items = [];

    console.log(`Generating ${itemCount} files (approx 1M items total)...`);

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
    console.log("Memory before indexing:", getMemoryUsage());

    const start = Date.now();
    engine.setItems(items);
    const duration = Date.now() - start;

    console.log(`Indexing took ${duration}ms`);
    console.log("Memory after indexing:", getMemoryUsage());

    if (global.gc) {
        global.gc();
        console.log("Memory after GC:", getMemoryUsage());
    }

    console.log("Benchmark complete.");
}

runMemoryBenchmark().catch(console.error);
